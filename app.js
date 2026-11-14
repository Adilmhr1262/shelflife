/* ShelfLife application logic.
   Single-page app, IndexedDB storage, no network requests. */
(function () {
  'use strict';

  var Dates = window.ShelfLifeDates;
  var DB = window.ShelfLifeDB;

  var SETTINGS_KEY = 'shelflife-settings-v1';
  var SCHEMA_VERSION = 1;
  var MAX_IMPORT_BYTES = 5 * 1024 * 1024;

  var CATEGORIES = ['Dairy', 'Meat & Seafood', 'Produce', 'Bakery', 'Sauces & Condiments', 'Beverages', 'Pantry', 'Other'];
  var LOCATIONS = ['Refrigerator', 'Freezer', 'Pantry', 'Countertop'];
  var STATUSES = ['active', 'used', 'discarded'];
  var DEFAULT_SETTINGS = { theme: 'system', threshold: 3 };

  var CATEGORY_ICONS = {
    'Dairy': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v3.5L8.5 8v12a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V8L14 6.5V3"/><path d="M8.5 12h7"/></svg>',
    'Meat & Seafood': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12c2.5-3.5 5.5-5 8-5 3 0 5.5 2 7 5-1.5 3-4 5-7 5-2.5 0-5.5-1.5-8-5z"/><circle cx="15.5" cy="11" r="1" fill="currentColor" stroke="none"/><path d="M3 12l-1-2.5M3 12l-1 2.5"/></svg>',
    'Produce': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8c-4 0-6.5 2.5-6.5 6.5 0 3.8 3 6.5 6.5 6.5s6.5-2.7 6.5-6.5C18.5 10.5 16 8 12 8z"/><path d="M12 8c0-2.5 1.5-4 3.5-4.5.3 2-1 3.8-3.5 4.5z"/></svg>',
    'Bakery': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a8 8 0 0 1 5-7.5L9.5 5h5L15 2.5A8 8 0 0 1 20 10v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z"/><path d="M9 13.5h.01M12 13.5h.01M15 13.5h.01"/></svg>',
    'Sauces & Condiments': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2h4M11 2v4l-2 3v11a1.5 1.5 0 0 0 1.5 1.5h3A1.5 1.5 0 0 0 15 20V9l-2-3V2"/><path d="M8.5 13h7"/></svg>',
    'Beverages': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12l-1.5 16a1.5 1.5 0 0 1-1.5 1.4h-6A1.5 1.5 0 0 1 7.5 20L6 4z"/><path d="M7 9h10"/><path d="M15 4c1.5 0 2-1 2-2"/></svg>',
    'Pantry': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8M9 3v3l-1.5 2v11a1.5 1.5 0 0 0 1.5 1.5h6A1.5 1.5 0 0 0 16.5 19V8L15 6V3"/><path d="M8 12h8"/></svg>',
    'Other': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8 12 3l8.5 5v8L12 21l-8.5-5V8z"/><path d="M3.5 8 12 13l8.5-5M12 13v8"/></svg>'
  };

  var STATUS_LABELS = {
    'fresh': 'Fresh',
    'use-soon': 'Use Soon',
    'use-today': 'Use Today',
    'past-date': 'Past Date'
  };

  /* ---------- state ---------- */
  var settings = loadSettings();
  var products = [];
  var currentSection = 'dashboard';
  var editingId = null;
  var openMenu = null;
  var lastFocus = null;
  var pendingImport = null;

  var filters = { search: '', category: 'all', location: 'all', status: 'all', sort: 'soonest' };
  var historyFilter = 'all';

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function nowISO() { return new Date().toISOString(); }

  function announce(message) {
    var region = $('sr-announcer');
    region.textContent = '';
    window.setTimeout(function () { region.textContent = message; }, 30);
  }

  function toast(message) {
    var region = $('toast-region');
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    region.appendChild(el);
    announce(message);
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 4000);
  }

  function showDbError(message) {
    var banner = $('db-error');
    banner.textContent = message;
    banner.hidden = false;
  }

  function hideDbError() {
    var banner = $('db-error');
    banner.hidden = true;
    banner.textContent = '';
  }

  /* ---------- settings ---------- */
  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { theme: DEFAULT_SETTINGS.theme, threshold: DEFAULT_SETTINGS.threshold };
      var parsed = JSON.parse(raw);
      var out = { theme: DEFAULT_SETTINGS.theme, threshold: DEFAULT_SETTINGS.threshold };
      if (parsed && (parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system')) out.theme = parsed.theme;
      if (parsed && Number.isInteger(parsed.threshold) && parsed.threshold >= 1 && parsed.threshold <= 7) out.threshold = parsed.threshold;
      return out;
    } catch (e) {
      return { theme: DEFAULT_SETTINGS.theme, threshold: DEFAULT_SETTINGS.threshold };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      showDbError('Settings could not be saved: ' + e.message);
    }
  }

  function resolveTheme() {
    if (settings.theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return settings.theme;
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', resolveTheme());
    document.documentElement.setAttribute('data-theme-choice', settings.theme);
    var label = settings.theme === 'light' ? 'Light theme' : settings.theme === 'dark' ? 'Dark theme' : 'System theme';
    $('theme-toggle-label').textContent = label;
    document.querySelectorAll('input[name="theme"]').forEach(function (radio) {
      radio.checked = radio.value === settings.theme;
    });
  }

  /* ---------- freshness calculations ---------- */
  function freshnessDeadline(product) {
    return Dates.addDays(product.openedDate, product.freshnessDays);
  }

  function effectiveUseBy(product) {
    var deadline = freshnessDeadline(product);
    if (product.printedExpiryDate) {
      return product.printedExpiryDate < deadline ? product.printedExpiryDate : deadline;
    }
    return deadline;
  }

  function daysRemaining(product) {
    return Dates.daysBetween(Dates.todayISO(), effectiveUseBy(product));
  }

  /* fresh | use-soon | use-today | past-date, for active products only. */
  function statusOf(product) {
    var days = daysRemaining(product);
    if (days === null) return 'past-date';
    if (days < 0) return 'past-date';
    if (days === 0) return 'use-today';
    if (days <= settings.threshold) return 'use-soon';
    return 'fresh';
  }

  function isAttention(product) {
    if (product.status !== 'active') return false;
    var s = statusOf(product);
    return s === 'use-soon' || s === 'use-today' || s === 'past-date';
  }

  function remainingText(product) {
    var days = daysRemaining(product);
    if (days === null) return 'Date unknown';
    if (days > 1) return days + ' days left';
    if (days === 1) return '1 day left';
    if (days === 0) return 'Use by today';
    if (days === -1) return '1 day past date';
    return Math.abs(days) + ' days past date';
  }

  /* ---------- derived lists ---------- */
  function activeProducts() {
    return products.filter(function (p) { return p.status === 'active'; });
  }

  function historyProducts() {
    return products.filter(function (p) { return p.status === 'used' || p.status === 'discarded'; });
  }

  function filteredProducts() {
    var q = filters.search.trim().toLowerCase();
    var list = activeProducts().filter(function (p) {
      if (q && p.name.toLowerCase().indexOf(q) === -1 && (p.notes || '').toLowerCase().indexOf(q) === -1) return false;
      if (filters.category !== 'all' && p.category !== filters.category) return false;
      if (filters.location !== 'all' && p.location !== filters.location) return false;
      if (filters.status !== 'all') {
        var s = statusOf(p);
        if (filters.status === 'attention') { if (!isAttention(p)) return false; }
        else if (filters.status === 'use-soon') { if (s !== 'use-soon' && s !== 'use-today') return false; }
        else if (s !== filters.status) return false;
      }
      return true;
    });
    if (filters.sort === 'soonest') {
      list.sort(function (a, b) {
        var d = effectiveUseBy(a).localeCompare(effectiveUseBy(b));
        return d !== 0 ? d : a.name.localeCompare(b.name);
      });
    } else if (filters.sort === 'recent') {
      list.sort(function (a, b) {
        var d = b.openedDate.localeCompare(a.openedDate);
        return d !== 0 ? d : b.createdAt.localeCompare(a.createdAt);
      });
    } else {
      list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }
    return list;
  }

  /* ---------- rendering ---------- */
  function renderDashboard() {
    var active = activeProducts();
    var soon = 0, past = 0;
    active.forEach(function (p) {
      var s = statusOf(p);
      if (s === 'use-soon' || s === 'use-today') soon++;
      if (s === 'past-date') past++;
    });
    $('stat-active').textContent = String(active.length);
    $('stat-soon').textContent = String(soon);
    $('stat-past').textContent = String(past);

    var attention = active.filter(isAttention).sort(function (a, b) {
      var d = effectiveUseBy(a).localeCompare(effectiveUseBy(b));
      return d !== 0 ? d : a.name.localeCompare(b.name);
    }).slice(0, 5);
    var attList = $('attention-list');
    attList.innerHTML = '';
    attention.forEach(function (p) {
      var li = document.createElement('li');
      li.innerHTML = '<div><div class="attention-name">' + esc(p.name) + '</div>' +
        '<div class="attention-meta">' + esc(p.category) + ' · Use by ' + esc(Dates.formatDate(effectiveUseBy(p))) + '</div></div>' +
        '<span class="status-badge status-' + statusOf(p) + '">' + esc(STATUS_LABELS[statusOf(p)]) + '</span>';
      attList.appendChild(li);
    });
    $('attention-empty').hidden = attention.length > 0;
    $('attention-view-all').style.visibility = attention.length > 0 ? 'visible' : 'hidden';

    var recent = active.slice().sort(function (a, b) {
      var d = b.openedDate.localeCompare(a.openedDate);
      return d !== 0 ? d : b.createdAt.localeCompare(a.createdAt);
    }).slice(0, 5);
    var recList = $('recent-list');
    recList.innerHTML = '';
    recent.forEach(function (p) {
      var li = document.createElement('li');
      li.innerHTML = '<div><div class="recent-name">' + esc(p.name) + '</div>' +
        '<div class="recent-meta">Opened ' + esc(Dates.formatDate(p.openedDate)) + ' · ' + esc(p.location) + '</div></div>' +
        '<span class="attention-meta">' + esc(remainingText(p)) + '</span>';
      recList.appendChild(li);
    });
    $('recent-empty').hidden = recent.length > 0;
    $('dashboard-empty').hidden = active.length > 0;
  }

  function cardHTML(p) {
    var s = statusOf(p);
    return '<div class="card-identity">' +
      '<span class="card-icon" aria-hidden="true">' + (CATEGORY_ICONS[p.category] || CATEGORY_ICONS.Other) + '</span>' +
      '<div><h3 class="card-title">' + esc(p.name) + '</h3>' +
      '<p class="card-category">' + esc(p.category) + ' · ' + esc(p.location) + '</p></div></div>' +
      '<dl class="card-dates">' +
      '<div><dt>Opened</dt><dd>' + esc(Dates.formatDate(p.openedDate)) + '</dd></div>' +
      '<div><dt>Use by</dt><dd>' + esc(Dates.formatDate(effectiveUseBy(p))) + '</dd></div>' +
      '</dl>' +
      (p.notes ? '<p class="card-notes">' + esc(p.notes) + '</p>' : '') +
      '<div class="card-foot">' +
      '<span class="status-badge status-' + s + '">' + esc(STATUS_LABELS[s]) + ' · ' + esc(remainingText(p)) + '</span>' +
      '<div class="menu-wrap">' +
      '<button type="button" class="btn btn-icon menu-btn" data-menu-for="' + esc(p.id) + '" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ' + esc(p.name) + '">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>' +
      '</button>' +
      '<div class="menu" role="menu" data-menu="' + esc(p.id) + '" hidden>' +
      '<button type="button" role="menuitem" data-action="edit" data-id="' + esc(p.id) + '">Edit</button>' +
      '<button type="button" role="menuitem" data-action="used" data-id="' + esc(p.id) + '">Mark Used</button>' +
      '<button type="button" role="menuitem" data-action="discard" data-id="' + esc(p.id) + '">Discard</button>' +
      '<button type="button" role="menuitem" class="danger" data-action="delete" data-id="' + esc(p.id) + '">Delete</button>' +
      '</div></div></div>';
  }

  function renderProducts() {
    var list = filteredProducts();
    var total = activeProducts().length;
    $('products-count').textContent = list.length === total
      ? total + (total === 1 ? ' active product' : ' active products')
      : list.length + ' of ' + total + ' active products';
    var grid = $('products-grid');
    grid.innerHTML = '';
    list.forEach(function (p) {
      var card = document.createElement('article');
      card.className = 'product-card';
      card.innerHTML = cardHTML(p);
      grid.appendChild(card);
    });
    var empty = $('products-empty');
    var filtersActive = filters.search.trim() !== '' || filters.category !== 'all' || filters.location !== 'all' || filters.status !== 'all';
    if (list.length === 0) {
      empty.hidden = false;
      if (total === 0) {
        $('products-empty-title').textContent = 'No products yet';
        $('products-empty-text').textContent = 'Add your first product to start tracking freshness.';
      } else if (filtersActive) {
        $('products-empty-title').textContent = 'No matching products';
        $('products-empty-text').textContent = 'Try a different search or filter.';
      } else {
        $('products-empty-title').textContent = 'No products in this view';
        $('products-empty-text').textContent = 'Try a different filter.';
      }
    } else {
      empty.hidden = true;
    }
  }

  function renderHistory() {
    var list = historyProducts().filter(function (p) {
      return historyFilter === 'all' || p.status === historyFilter;
    });
    list.sort(function (a, b) {
      var d = (b.completedAt || '').localeCompare(a.completedAt || '');
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    var ul = $('history-list');
    ul.innerHTML = '';
    list.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'history-item';
      var outcome = p.status === 'used' ? 'Used' : 'Discarded';
      li.innerHTML = '<div><h3 class="card-title">' + esc(p.name) + '</h3>' +
        '<div class="history-meta"><span>' + esc(p.category) + ' · ' + esc(p.location) + '</span>' +
        '<span>Opened ' + esc(Dates.formatDate(p.openedDate)) + '</span>' +
        '<span>' + outcome + ' ' + esc(Dates.formatDate((p.completedAt || '').slice(0, 10))) + '</span></div></div>' +
        '<div class="history-actions">' +
        '<button type="button" class="btn btn-secondary" data-action="restore" data-id="' + esc(p.id) + '">Restore</button>' +
        '<button type="button" class="btn btn-secondary" data-action="delete-history" data-id="' + esc(p.id) + '">Delete</button>' +
        '</div>';
      ul.appendChild(li);
    });
    $('history-empty').hidden = list.length > 0;
  }

  function renderStorageInfo() {
    var active = activeProducts().length;
    var hist = historyProducts().length;
    $('storage-count').textContent = String(products.length);
    $('storage-active').textContent = String(active);
    $('storage-history').textContent = String(hist);
    var el = $('storage-estimate');
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      navigator.storage.estimate().then(function (est) {
        el.textContent = est.usage != null ? formatBytes(est.usage) : 'Not available';
      }).catch(function () { el.textContent = 'Not available'; });
    } else {
      el.textContent = 'Not available';
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function renderAll() {
    renderDashboard();
    renderProducts();
    renderHistory();
    renderStorageInfo();
  }

  /* ---------- navigation ---------- */
  function showSection(name) {
    currentSection = name;
    ['dashboard', 'products', 'history', 'settings'].forEach(function (s) {
      $('section-' + s).hidden = s !== name;
    });
    document.querySelectorAll('[data-section]').forEach(function (btn) {
      var active = btn.getAttribute('data-section') === name;
      btn.classList.toggle('is-active', active);
      if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
    if (name === 'settings') renderStorageInfo();
  }

  /* ---------- dialogs ---------- */
  function openDialog(dlg, opener) {
    lastFocus = opener || document.activeElement;
    if (!dlg.open) dlg.showModal();
    var first = dlg.querySelector('input, select, textarea, button');
    if (first) first.focus();
  }

  function closeDialog(dlg) {
    if (dlg.open) dlg.close();
  }

  document.querySelectorAll('dialog').forEach(function (dlg) {
    dlg.addEventListener('close', function () {
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    });
  });

  document.querySelectorAll('[data-close-dialog]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      closeDialog(btn.closest('dialog'));
    });
  });

  /* Generic confirm: returns a Promise<boolean>. */
  function askConfirm(title, text, yesLabel) {
    return new Promise(function (resolve) {
      var dlg = $('confirm-dialog');
      $('confirm-title').textContent = title;
      $('confirm-text').textContent = text;
      var yes = $('confirm-yes');
      yes.textContent = yesLabel || 'Delete';
      var done = false;
      function finish(value) {
        if (done) return;
        done = true;
        yes.removeEventListener('click', onYes);
        dlg.removeEventListener('close', onClose);
        resolve(value);
      }
      function onYes() { closeDialog(dlg); finish(true); }
      function onClose() { finish(false); }
      yes.addEventListener('click', onYes);
      dlg.addEventListener('close', onClose);
      openDialog(dlg, document.activeElement);
    });
  }

  /* ---------- product form ---------- */
  function fillSelectOptions(select, values, allLabel) {
    select.innerHTML = '';
    if (allLabel) {
      var all = document.createElement('option');
      all.value = 'all';
      all.textContent = allLabel;
      select.appendChild(all);
    }
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
  }

  function clearFieldErrors() {
    ['name', 'category', 'location', 'opened', 'days', 'expiry', 'notes'].forEach(function (key) {
      var err = $('err-' + key);
      if (err) { err.hidden = true; err.textContent = ''; }
    });
    ['field-name', 'field-category', 'field-location', 'field-opened', 'field-days', 'field-expiry', 'field-notes'].forEach(function (id) {
      var el = $(id);
      if (el) el.removeAttribute('aria-invalid');
    });
    var formErr = $('form-error');
    formErr.hidden = true;
    formErr.textContent = '';
  }

  function setFieldError(key, message) {
    var err = $('err-' + key);
    var inputMap = { name: 'field-name', category: 'field-category', location: 'field-location', opened: 'field-opened', days: 'field-days', expiry: 'field-expiry', notes: 'field-notes' };
    if (err) { err.textContent = message; err.hidden = false; }
    var input = $(inputMap[key]);
    if (input) input.setAttribute('aria-invalid', 'true');
  }

  function openProductForm(product) {
    editingId = product ? product.id : null;
    clearFieldErrors();
    $('product-dialog-title').textContent = product ? 'Edit Product' : 'Add Product';
    $('product-save-btn').textContent = product ? 'Save Changes' : 'Save Product';
    var today = Dates.todayISO();
    $('field-name').value = product ? product.name : '';
    $('field-category').value = product ? product.category : CATEGORIES[0];
    $('field-location').value = product ? product.location : LOCATIONS[0];
    $('field-opened').value = product ? product.openedDate : today;
    $('field-days').value = product ? String(product.freshnessDays) : '3';
    $('field-expiry').value = product && product.printedExpiryDate ? product.printedExpiryDate : '';
    $('field-notes').value = product ? (product.notes || '') : '';
    openDialog($('product-dialog'), document.activeElement);
  }

  function readForm() {
    return {
      name: $('field-name').value.trim(),
      category: $('field-category').value,
      location: $('field-location').value,
      openedDate: $('field-opened').value,
      freshnessDaysRaw: $('field-days').value.trim(),
      printedExpiryDate: $('field-expiry').value || null,
      notes: $('field-notes').value.trim()
    };
  }

  function validateForm(values) {
    var errors = {};
    if (!values.name || values.name.length < 1 || values.name.length > 80) {
      errors.name = 'Enter a product name of 1 to 80 characters.';
    }
    if (CATEGORIES.indexOf(values.category) === -1) errors.category = 'Choose a category.';
    if (LOCATIONS.indexOf(values.location) === -1) errors.location = 'Choose a storage location.';
    if (!Dates.isValidISODate(values.openedDate)) errors.opened = 'Enter a valid opened date.';
    var days = Number(values.freshnessDaysRaw);
    if (values.freshnessDaysRaw === '' || !Number.isInteger(days) || days < 1 || days > 365) {
      errors.days = 'Enter a whole number of days from 1 to 365.';
    }
    if (values.printedExpiryDate) {
      if (!Dates.isValidISODate(values.printedExpiryDate)) {
        errors.expiry = 'Enter a valid printed expiry date, or leave it blank.';
      } else if (Dates.isValidISODate(values.openedDate) && values.printedExpiryDate < values.openedDate) {
        errors.expiry = 'Printed expiry date cannot be earlier than the opened date.';
      }
    }
    if (values.notes.length > 300) errors.notes = 'Notes can be at most 300 characters.';
    return errors;
  }

  $('product-form').addEventListener('submit', function (event) {
    event.preventDefault();
    clearFieldErrors();
    var values = readForm();
    var errors = validateForm(values);
    if (Object.keys(errors).length > 0) {
      Object.keys(errors).forEach(function (key) { setFieldError(key, errors[key]); });
      var firstKey = Object.keys(errors)[0];
      var inputMap = { name: 'field-name', category: 'field-category', location: 'field-location', opened: 'field-opened', days: 'field-days', expiry: 'field-expiry', notes: 'field-notes' };
      $(inputMap[firstKey]).focus();
      return;
    }
    var now = nowISO();
    var record;
    if (editingId) {
      var existing = products.find(function (p) { return p.id === editingId; });
      if (!existing) {
        $('form-error').textContent = 'That product no longer exists.';
        $('form-error').hidden = false;
        return;
      }
      record = {
        id: existing.id,
        name: values.name,
        category: values.category,
        location: values.location,
        openedDate: values.openedDate,
        freshnessDays: Number(values.freshnessDaysRaw),
        printedExpiryDate: values.printedExpiryDate,
        notes: values.notes,
        status: existing.status,
        completedAt: existing.completedAt,
        createdAt: existing.createdAt,
        updatedAt: now
      };
    } else {
      record = {
        id: newId(),
        name: values.name,
        category: values.category,
        location: values.location,
        openedDate: values.openedDate,
        freshnessDays: Number(values.freshnessDaysRaw),
        printedExpiryDate: values.printedExpiryDate,
        notes: values.notes,
        status: 'active',
        completedAt: null,
        createdAt: now,
        updatedAt: now
      };
    }
    $('product-save-btn').disabled = true;
    DB.putProduct(record).then(function () {
      var idx = products.findIndex(function (p) { return p.id === record.id; });
      if (idx >= 0) products[idx] = record; else products.push(record);
      $('product-save-btn').disabled = false;
      closeDialog($('product-dialog'));
      renderAll();
      toast(editingId ? 'Product updated.' : 'Product added.');
    }).catch(function (err) {
      $('product-save-btn').disabled = false;
      $('form-error').textContent = 'Could not save the product: ' + err.message;
      $('form-error').hidden = false;
    });
  });

  /* ---------- card actions ---------- */
  function closeOpenMenu() {
    if (openMenu) {
      openMenu.hidden = true;
      var btn = document.querySelector('[data-menu-for="' + openMenu.getAttribute('data-menu') + '"]');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      openMenu = null;
    }
  }

  document.addEventListener('click', function (event) {
    var menuBtn = event.target.closest('[data-menu-for]');
    if (menuBtn) {
      var menu = document.querySelector('[data-menu="' + menuBtn.getAttribute('data-menu-for') + '"]');
      if (openMenu && openMenu !== menu) closeOpenMenu();
      if (menu.hidden) {
        menu.hidden = false;
        menuBtn.setAttribute('aria-expanded', 'true');
        openMenu = menu;
        var first = menu.querySelector('button');
        if (first) first.focus();
      } else {
        closeOpenMenu();
      }
      event.stopPropagation();
      return;
    }
    if (openMenu && !event.target.closest('.menu')) closeOpenMenu();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && openMenu) {
      var id = openMenu.getAttribute('data-menu');
      closeOpenMenu();
      var btn = document.querySelector('[data-menu-for="' + id + '"]');
      if (btn) btn.focus();
    }
  });

  function findProduct(id) {
    return products.find(function (p) { return p.id === id; });
  }

  function completeProduct(id, outcome) {
    var p = findProduct(id);
    if (!p) return;
    var record = Object.assign({}, p, { status: outcome, completedAt: nowISO(), updatedAt: nowISO() });
    DB.putProduct(record).then(function () {
      var idx = products.findIndex(function (x) { return x.id === id; });
      if (idx >= 0) products[idx] = record;
      renderAll();
      toast(outcome === 'used' ? 'Marked as used.' : 'Discarded.');
    }).catch(function (err) {
      showDbError('Could not update the product: ' + err.message);
    });
  }

  function deleteProductById(id) {
    var p = findProduct(id);
    if (!p) return;
    DB.deleteProduct(id).then(function () {
      products = products.filter(function (x) { return x.id !== id; });
      renderAll();
      toast('Product deleted.');
    }).catch(function (err) {
      showDbError('Could not delete the product: ' + err.message);
    });
  }

  document.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');
    var p = findProduct(id);
    if (!p) return;
    closeOpenMenu();
    if (action === 'edit') {
      openProductForm(p);
    } else if (action === 'used') {
      completeProduct(id, 'used');
    } else if (action === 'discard') {
      completeProduct(id, 'discarded');
    } else if (action === 'delete') {
      askConfirm('Delete product?', 'Delete "' + p.name + '" permanently? This cannot be undone.', 'Delete').then(function (ok) {
        if (ok) deleteProductById(id);
      });
    } else if (action === 'delete-history') {
      askConfirm('Delete permanently?', 'Delete "' + p.name + '" from History permanently? This cannot be undone.', 'Delete').then(function (ok) {
        if (ok) deleteProductById(id);
      });
    } else if (action === 'restore') {
      var record = Object.assign({}, p, { status: 'active', completedAt: null, updatedAt: nowISO() });
      DB.putProduct(record).then(function () {
        var idx = products.findIndex(function (x) { return x.id === id; });
        if (idx >= 0) products[idx] = record;
        renderAll();
        toast('Product restored to active.');
      }).catch(function (err) {
        showDbError('Could not restore the product: ' + err.message);
      });
    }
  });

  /* ---------- navigation wiring ---------- */
  document.querySelectorAll('[data-section]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showSection(btn.getAttribute('data-section'));
    });
  });

  $('attention-view-all').addEventListener('click', function () {
    filters.status = 'attention';
    $('filter-status').value = 'attention';
    renderProducts();
    showSection('products');
  });

  document.querySelectorAll('[data-open-add]').forEach(function (btn) {
    btn.addEventListener('click', function () { openProductForm(null); });
  });
  $('add-product-btn').addEventListener('click', function () { openProductForm(null); });

  /* ---------- filters ---------- */
  $('search-input').addEventListener('input', function () {
    filters.search = $('search-input').value;
    renderProducts();
  });
  $('filter-category').addEventListener('change', function () {
    filters.category = $('filter-category').value;
    renderProducts();
  });
  $('filter-location').addEventListener('change', function () {
    filters.location = $('filter-location').value;
    renderProducts();
  });
  $('filter-status').addEventListener('change', function () {
    filters.status = $('filter-status').value;
    renderProducts();
  });
  $('sort-select').addEventListener('change', function () {
    filters.sort = $('sort-select').value;
    renderProducts();
  });
  $('history-filter').addEventListener('change', function () {
    historyFilter = $('history-filter').value;
    renderHistory();
  });
  $('clear-filters-btn').addEventListener('click', function () {
    filters = { search: '', category: 'all', location: 'all', status: 'all', sort: 'soonest' };
    $('search-input').value = '';
    $('filter-category').value = 'all';
    $('filter-location').value = 'all';
    $('filter-status').value = 'all';
    $('sort-select').value = 'soonest';
    renderProducts();
    $('search-input').focus();
  });

  /* ---------- settings wiring ---------- */
  $('theme-toggle').addEventListener('click', function () {
    var order = ['light', 'dark', 'system'];
    var next = order[(order.indexOf(settings.theme) + 1) % order.length];
    settings.theme = next;
    saveSettings();
    applyTheme();
    toast('Theme: ' + next + '.');
  });

  document.querySelectorAll('input[name="theme"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      settings.theme = radio.value;
      saveSettings();
      applyTheme();
      toast('Theme: ' + radio.value + '.');
    });
  });

  $('threshold-input').addEventListener('change', function () {
    var value = Number($('threshold-input').value);
    if (!Number.isInteger(value) || value < 1 || value > 7) {
      $('threshold-error').hidden = false;
      $('threshold-input').value = String(settings.threshold);
      return;
    }
    $('threshold-error').hidden = true;
    settings.threshold = value;
    saveSettings();
    renderAll();
    toast('Reminder threshold set to ' + value + ' day' + (value === 1 ? '' : 's') + '.');
  });

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (settings.theme === 'system') applyTheme();
    });
  }

  /* ---------- export / import ---------- */
  function backupFileName() {
    return 'shelflife-backup-' + Dates.todayISO() + '.json';
  }

  $('export-btn').addEventListener('click', function () {
    var data = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: nowISO(),
      products: products,
      settings: { theme: settings.theme, threshold: settings.threshold }
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup exported.');
  });

  function validateBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Backup file is not a JSON object.');
    if (data.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported backup version. Expected schemaVersion 1.');
    if (!Array.isArray(data.products)) throw new Error('Backup file has no products list.');
    var seen = {};
    data.products.forEach(function (p, i) {
      var where = 'Product ' + (i + 1);
      if (!p || typeof p !== 'object') throw new Error(where + ' is not an object.');
      if (typeof p.id !== 'string' || p.id.length === 0) throw new Error(where + ' has no valid id.');
      if (seen[p.id]) throw new Error('Duplicate product id: ' + p.id);
      seen[p.id] = true;
      if (typeof p.name !== 'string' || p.name.length < 1 || p.name.length > 80) throw new Error(where + ' has an invalid name.');
      if (CATEGORIES.indexOf(p.category) === -1) throw new Error(where + ' has an invalid category.');
      if (LOCATIONS.indexOf(p.location) === -1) throw new Error(where + ' has an invalid storage location.');
      if (!Dates.isValidISODate(p.openedDate)) throw new Error(where + ' has an invalid opened date.');
      if (!Number.isInteger(p.freshnessDays) || p.freshnessDays < 1 || p.freshnessDays > 365) throw new Error(where + ' has an invalid freshness duration.');
      if (p.printedExpiryDate !== null && p.printedExpiryDate !== undefined) {
        if (!Dates.isValidISODate(p.printedExpiryDate)) throw new Error(where + ' has an invalid printed expiry date.');
        if (p.printedExpiryDate < p.openedDate) throw new Error(where + ' has a printed expiry date before its opened date.');
      }
      if (p.notes !== null && p.notes !== undefined && (typeof p.notes !== 'string' || p.notes.length > 300)) throw new Error(where + ' has invalid notes.');
      if (STATUSES.indexOf(p.status) === -1) throw new Error(where + ' has an invalid status.');
      if (p.status === 'active') {
        if (p.completedAt !== null && p.completedAt !== undefined) throw new Error(where + ' is active but has a completion date.');
      } else {
        if (!Dates.isValidTimestamp(p.completedAt)) throw new Error(where + ' is completed but has no valid completion date.');
      }
      if (!Dates.isValidTimestamp(p.createdAt) || !Dates.isValidTimestamp(p.updatedAt)) throw new Error(where + ' has invalid timestamps.');
    });
    var outSettings = { theme: DEFAULT_SETTINGS.theme, threshold: DEFAULT_SETTINGS.threshold };
    if (data.settings !== null && data.settings !== undefined) {
      if (typeof data.settings !== 'object' || Array.isArray(data.settings)) throw new Error('Backup settings are invalid.');
      if (data.settings.theme !== undefined) {
        if (['light', 'dark', 'system'].indexOf(data.settings.theme) === -1) throw new Error('Backup has an invalid theme setting.');
        outSettings.theme = data.settings.theme;
      }
      if (data.settings.threshold !== undefined) {
        if (!Number.isInteger(data.settings.threshold) || data.settings.threshold < 1 || data.settings.threshold > 7) throw new Error('Backup has an invalid reminder threshold.');
        outSettings.threshold = data.settings.threshold;
      }
    }
    var normalized = data.products.map(function (p) {
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        location: p.location,
        openedDate: p.openedDate,
        freshnessDays: p.freshnessDays,
        printedExpiryDate: p.printedExpiryDate || null,
        notes: p.notes || '',
        status: p.status,
        completedAt: p.completedAt || null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      };
    });
    return { products: normalized, settings: outSettings };
  }

  $('import-btn').addEventListener('click', function () {
    $('import-error').hidden = true;
    $('import-error').textContent = '';
    $('import-file').click();
  });

  $('import-file').addEventListener('change', function () {
    var file = $('import-file').files && $('import-file').files[0];
    $('import-file').value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showImportError('Backup file is larger than 5 MB.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (e) {
        showImportError('Backup file is not valid JSON: ' + e.message);
        return;
      }
      var validated;
      try {
        validated = validateBackup(parsed);
      } catch (e) {
        showImportError('Backup file is invalid: ' + e.message);
        return;
      }
      pendingImport = validated;
      $('import-text').textContent = 'This backup contains ' + validated.products.length + ' product' + (validated.products.length === 1 ? '' : 's') + '. Importing replaces all current data.';
      openDialog($('import-dialog'), $('import-btn'));
    };
    reader.onerror = function () {
      showImportError('Could not read the backup file.');
    };
    reader.readAsText(file);
  });

  function showImportError(message) {
    var el = $('import-error');
    el.textContent = message;
    el.hidden = false;
    announce(message);
  }

  $('import-confirm').addEventListener('click', function () {
    if (!pendingImport) return;
    var data = pendingImport;
    pendingImport = null;
    closeDialog($('import-dialog'));
    DB.replaceAllProducts(data.products).then(function () {
      settings = data.settings;
      saveSettings();
      applyTheme();
      $('threshold-input').value = String(settings.threshold);
      return DB.getAllProducts();
    }).then(function (all) {
      products = all;
      renderAll();
      toast('Backup imported: ' + data.products.length + ' products.');
    }).catch(function (err) {
      showDbError('Import failed, existing data was kept: ' + err.message);
    });
  });

  /* ---------- clear all ---------- */
  $('clear-all-btn').addEventListener('click', function () {
    $('clear-text').textContent = 'This will permanently delete ' + products.length + ' product' + (products.length === 1 ? '' : 's') + ' and reset settings to defaults.';
    $('clear-confirm-input').value = '';
    $('clear-confirm-btn').disabled = true;
    $('err-clear').hidden = true;
    openDialog($('clear-dialog'), $('clear-all-btn'));
  });

  $('clear-confirm-input').addEventListener('input', function () {
    var ok = $('clear-confirm-input').value === 'DELETE';
    $('clear-confirm-btn').disabled = !ok;
    $('err-clear').hidden = ok;
  });

  $('clear-confirm-btn').addEventListener('click', function () {
    if ($('clear-confirm-input').value !== 'DELETE') {
      $('err-clear').hidden = false;
      return;
    }
    DB.clearAllProducts().then(function () {
      products = [];
      settings = { theme: DEFAULT_SETTINGS.theme, threshold: DEFAULT_SETTINGS.threshold };
      saveSettings();
      applyTheme();
      $('threshold-input').value = String(settings.threshold);
      closeDialog($('clear-dialog'));
      renderAll();
      showSection('dashboard');
      toast('All data cleared.');
    }).catch(function (err) {
      showDbError('Could not clear data: ' + err.message);
    });
  });

  /* ---------- init ---------- */
  function init() {
    fillSelectOptions($('filter-category'), CATEGORIES, 'All Categories');
    fillSelectOptions($('filter-location'), LOCATIONS, 'All Locations');
    fillSelectOptions($('field-category'), CATEGORIES);
    fillSelectOptions($('field-location'), LOCATIONS);
    $('threshold-input').value = String(settings.threshold);
    applyTheme();
    showSection('dashboard');
    DB.getAllProducts().then(function (all) {
      products = all || [];
      renderAll();
    }).catch(function (err) {
      showDbError(err.message);
      renderAll();
    });
    if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* Offline support is best effort; the app works without it. */
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
