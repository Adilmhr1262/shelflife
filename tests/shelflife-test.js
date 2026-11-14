/* ShelfLife verification suite (headless Firefox via playwright-core).
   Serves the project over local HTTP, then runs the order's 20 acceptance
   tests plus form-validation checks. Usage: node tests/shelflife-test.js */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT = '/home/hatch/workspace/daily-projects/2026-11-14-shelflife';
const PORT = 8137;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; failures.push(name); console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pad(n) { return (n < 10 ? '0' : '') + n; }
function dateStr(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtDate(iso) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const p = iso.split('-');
  return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const file = path.join(PROJECT, urlPath);
      if (!file.startsWith(PROJECT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function dbCount(page) {
  return await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('shelflife-db', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('products', 'readonly');
      const all = tx.objectStore('products').getAll();
      all.onsuccess = () => resolve(all.result.length);
      all.onerror = () => reject(new Error('getAll failed'));
    };
    req.onerror = () => reject(new Error('open failed'));
  }));
}

async function addProduct(page, fields) {
  await page.click('#add-product-btn:visible, [data-open-add]:visible');
  await page.waitForSelector('#product-dialog[open]', { timeout: 5000 });
  await page.fill('#field-name', fields.name);
  await page.selectOption('#field-category', fields.category);
  await page.selectOption('#field-location', fields.location);
  await page.fill('#field-opened', fields.opened);
  await page.fill('#field-days', String(fields.days));
  if (fields.expiry) await page.fill('#field-expiry', fields.expiry); else await page.fill('#field-expiry', '');
  if (fields.notes) await page.fill('#field-notes', fields.notes);
  await page.click('#product-save-btn');
  await sleep(400);
}

async function visibleText(page, sel) {
  return (await page.textContent(sel)) || '';
}

(async () => {
  const server = await serve();
  const browser = await firefox.launch();
  const errors = [];
  const requests = [];
  let context, page;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    page = await context.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('request', r => requests.push(r.url()));

    // 1. Fresh installation
    await page.goto(BASE, { waitUntil: 'load' });
    await sleep(800);
    check('1 fresh install: zero products, zero counts, empty state', (await dbCount(page)) === 0 &&
      (await visibleText(page, '#stat-active')) === '0' &&
      (await visibleText(page, '#stat-soon')) === '0' &&
      (await visibleText(page, '#stat-past')) === '0' &&
      await page.isVisible('#dashboard-empty'));
    check('1b no demo products on first launch', (await page.textContent('#recent-list')) === '');

    // 2. Create Greek Yogurt
    await addProduct(page, { name: 'Greek Yogurt', category: 'Dairy', location: 'Refrigerator', opened: dateStr(0), days: 5, expiry: dateStr(8), notes: 'Opened after breakfast' });
    const dlgClosed = await page.evaluate(() => !document.getElementById('product-dialog').open);
    check('2 create: dialog closes, toast shown', dlgClosed && (await page.textContent('#toast-region')).includes('Product added'));
    await page.click('[data-section="products"]');
    await sleep(300);
    const gridText = await page.textContent('#products-grid');
    check('2b create: product shown with entered data', gridText.includes('Greek Yogurt') && gridText.includes('Dairy') &&
      gridText.includes('Refrigerator') && gridText.includes('Opened after breakfast') &&
      gridText.includes(fmtDate(dateStr(0))) && gridText.includes(fmtDate(dateStr(5))));

    // 3. Persistence across reload
    await page.reload({ waitUntil: 'load' });
    await sleep(600);
    check('3 persistence after reload', (await dbCount(page)) === 1 &&
      (await page.textContent('#products-grid')).includes('Greek Yogurt'));

    // 4. Date calculation: opened today + 5 days = use-by in 5 days
    await page.click('[data-section="products"]');
    check('4 date calc: opened today + 5 days use-by shown', (await page.textContent('#products-grid')).includes(fmtDate(dateStr(5))));

    // 5. Printed expiry earlier takes precedence
    await addProduct(page, { name: 'Fresh Milk', category: 'Dairy', location: 'Refrigerator', opened: dateStr(0), days: 10, expiry: dateStr(2) });
    await sleep(300);
    const milkCard = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.product-card'));
      const c = cards.find(el => el.textContent.includes('Fresh Milk'));
      return c ? c.textContent : '';
    });
    check('5 printed expiry earlier takes precedence', milkCard.includes(fmtDate(dateStr(2))) && milkCard.includes('2 days left'));

    // 6. Status boundaries
    await addProduct(page, { name: 'Soon Sauce', category: 'Sauces & Condiments', location: 'Pantry', opened: dateStr(-1), days: 3 }); // use-by +2 -> Use Soon
    await addProduct(page, { name: 'Today Bread', category: 'Bakery', location: 'Countertop', opened: dateStr(-2), days: 2 }); // use-by today -> Use Today
    await addProduct(page, { name: 'Old Berries', category: 'Produce', location: 'Refrigerator', opened: dateStr(-4), days: 2 }); // use-by -2 -> Past Date
    await sleep(400);
    const statusOf = async (name) => await page.evaluate((n) => {
      const cards = Array.from(document.querySelectorAll('.product-card'));
      const c = cards.find(el => el.textContent.includes(n));
      if (!c) return 'missing';
      const b = c.querySelector('.status-badge');
      return b ? b.textContent : 'no-badge';
    }, name);
    check('6a Fresh status (5 days left)', (await statusOf('Greek Yogurt')).includes('Fresh'));
    check('6b Use Soon status (2 days left)', (await statusOf('Soon Sauce')).includes('Use Soon'));
    check('6c Use Today status (0 days)', (await statusOf('Today Bread')).includes('Use Today'));
    check('6d Past Date status (-2 days)', (await statusOf('Old Berries')).includes('Past Date'));
    await page.click('[data-section="dashboard"]');
    await sleep(300);
    check('6e dashboard counts: 5 active, 3 use soon (incl today), 1 past', (await visibleText(page, '#stat-active')) === '5' &&
      (await visibleText(page, '#stat-soon')) === '3' && (await visibleText(page, '#stat-past')) === '1');
    const attText = await page.textContent('#attention-list');
    const attCount = await page.evaluate(() => document.querySelectorAll('#attention-list li').length);
    check('6f needs attention lists 4 items, earliest first', attCount === 4 && attText.includes('Fresh Milk') && attText.includes('Old Berries') && attText.includes('Today Bread') && attText.includes('Soon Sauce') &&
      attText.indexOf('Old Berries') < attText.indexOf('Today Bread') && attText.indexOf('Today Bread') < attText.indexOf('Fresh Milk') && attText.indexOf('Fresh Milk') < attText.indexOf('Soon Sauce'));

    // 7. Search and filters combined
    await page.click('[data-section="products"]');
    await sleep(300);
    await page.fill('#search-input', 'yogurt');
    await sleep(300);
    check('7a search by name', (await page.textContent('#products-grid')).includes('Greek Yogurt') &&
      !(await page.textContent('#products-grid')).includes('Fresh Milk'));
    await page.fill('#search-input', '');
    await page.selectOption('#filter-category', 'Dairy');
    await sleep(300);
    let gt = await page.textContent('#products-grid');
    check('7b category filter', gt.includes('Greek Yogurt') && gt.includes('Fresh Milk') && !gt.includes('Soon Sauce'));
    await page.selectOption('#filter-location', 'Refrigerator');
    await sleep(300);
    gt = await page.textContent('#products-grid');
    check('7c category + location combined', gt.includes('Greek Yogurt') && gt.includes('Fresh Milk'));
    await page.selectOption('#filter-status', 'past-date');
    await sleep(300);
    check('7d status filter narrows to none', (await page.textContent('#products-grid')).trim() === '' && await page.isVisible('#products-empty'));
    await page.selectOption('#filter-status', 'all');
    await page.selectOption('#filter-category', 'all');
    await page.selectOption('#filter-location', 'all');
    await page.selectOption('#sort-select', 'name');
    await sleep(300);
    const names = await page.evaluate(() => Array.from(document.querySelectorAll('.product-card .card-title')).map(e => e.textContent));
    check('7e sort Name A-Z', JSON.stringify(names) === JSON.stringify(['Fresh Milk', 'Greek Yogurt', 'Old Berries', 'Soon Sauce', 'Today Bread']), names.join(','));
    await page.selectOption('#sort-select', 'soonest');
    await sleep(200);

    // 8. Edit persists across reload
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.product-card'));
      const c = cards.find(el => el.textContent.includes('Greek Yogurt'));
      c.querySelector('[data-menu-for]').click();
    });
    await sleep(300);
    await page.click('.menu:not([hidden]) [data-action="edit"]');
    await sleep(300);
    await page.fill('#field-notes', 'Edited note');
    await page.click('#product-save-btn');
    await sleep(400);
    await page.reload({ waitUntil: 'load' });
    await sleep(600);
    await page.click('[data-section="products"]');
    await sleep(300);
    check('8 edit persists across reload', (await page.textContent('#products-grid')).includes('Edited note'));

    // 9. Completion moves items to History
    async function cardAction(name, action) {
      await page.evaluate((n) => {
        const cards = Array.from(document.querySelectorAll('.product-card'));
        const c = cards.find(el => el.textContent.includes(n));
        if (c) c.querySelector('[data-menu-for]').click();
      }, name);
      await sleep(300);
      await page.click('.menu:not([hidden]) [data-action="' + action + '"]');
      await sleep(400);
    }
    await cardAction('Fresh Milk', 'used');
    await cardAction('Soon Sauce', 'discard');
    await sleep(300);
    const afterComplete = await page.textContent('#products-grid');
    check('9a mark used + discard remove from active', !afterComplete.includes('Fresh Milk') && !afterComplete.includes('Soon Sauce'));
    await page.click('[data-section="history"]');
    await sleep(300);
    const histText = await page.textContent('#history-list');
    check('9b history shows both with outcomes', histText.includes('Fresh Milk') && histText.includes('Soon Sauce') && histText.includes('Used') && histText.includes('Discarded'));

    // 10. Restore returns to active without duplication
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.history-item'));
      const it = items.find(el => el.textContent.includes('Fresh Milk'));
      it.querySelector('[data-action="restore"]').click();
    });
    await sleep(400);
    await page.click('[data-section="products"]');
    await sleep(300);
    const restored = (await page.textContent('#products-grid')).match(/Fresh Milk/g) || [];
    check('10 restore returns to active, no duplicate', restored.length === 1 && (await dbCount(page)) === 5);

    // 11. Permanent deletion removes only the selected product
    await cardAction('Old Berries', 'delete');
    await sleep(300);
    await page.click('#confirm-yes');
    await sleep(400);
    const afterDelete = await page.textContent('#products-grid');
    check('11 delete removes only selected, counts update', !afterDelete.includes('Old Berries') && afterDelete.includes('Greek Yogurt') && (await dbCount(page)) === 4);

    // 12. Backup round trip
    const downloadPromise = page.waitForEvent('download', { timeout: 8000 });
    await page.click('[data-section="settings"]');
    await sleep(300);
    await page.click('#export-btn');
    const download = await downloadPromise;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-test-'));
    const backupPath = path.join(tmpDir, 'backup.json');
    await download.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    check('12a export file valid, schemaVersion 1', backup.schemaVersion === 1 && Array.isArray(backup.products) && backup.products.length === 4 && backup.settings && backup.settings.threshold === 3);
    // clear all, then reimport
    await page.click('#clear-all-btn');
    await sleep(300);
    await page.fill('#clear-confirm-input', 'DELETE');
    await page.click('#clear-confirm-btn');
    await sleep(500);
    check('12b clear all empties store', (await dbCount(page)) === 0);
    await page.setInputFiles('#import-file', backupPath);
    await sleep(500);
    const importShown = await page.evaluate(() => document.getElementById('import-dialog').open);
    const importText = await page.textContent('#import-text');
    check('12c import dialog shows product count', importShown && importText.includes('4 products'));
    await page.click('#import-confirm');
    await sleep(600);
    check('12d reimport restores products and history state', (await dbCount(page)) === 4 &&
      (await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open('shelflife-db', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction('products', 'readonly');
          const all = tx.objectStore('products').getAll();
          all.onsuccess = () => resolve(all.result.filter(p => p.status === 'discarded').length);
        };
      }))) === 1);

    // 13. Invalid backups leave data unchanged
    async function tryBadImport(obj, label) {
      const badPath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(badPath, typeof obj === 'string' ? obj : JSON.stringify(obj));
      await page.setInputFiles('#import-file', badPath);
      await sleep(500);
      const errVisible = await page.evaluate(() => !document.getElementById('import-error').hidden);
      const count = await dbCount(page);
      check('13 ' + label + ' rejected, data unchanged', errVisible && count === 4);
    }
    await tryBadImport('not json at all', 'malformed JSON');
    const dup = JSON.parse(JSON.stringify(backup));
    dup.products.push(JSON.parse(JSON.stringify(dup.products[0])));
    await tryBadImport(dup, 'duplicate ID');
    const badDate = JSON.parse(JSON.stringify(backup));
    badDate.products[0].openedDate = '2026-13-40';
    await tryBadImport(badDate, 'invalid date');

    // 14. Clear all requires DELETE and resets settings
    await page.click('[data-section="settings"]');
    await sleep(300);
    await page.click('#clear-all-btn');
    await sleep(300);
    await page.fill('#clear-confirm-input', 'delete');
    const btnDisabled = await page.evaluate(() => document.getElementById('clear-confirm-btn').disabled);
    check('14a lowercase delete does not enable confirm', btnDisabled === true);
    await page.fill('#clear-confirm-input', 'DELETE');
    await page.click('#clear-confirm-btn');
    await sleep(500);
    const afterClear = await page.evaluate(() => ({
      theme: JSON.parse(localStorage.getItem('shelflife-settings-v1') || '{}'),
      count: 0
    }));
    check('14b clear all resets records and settings', (await dbCount(page)) === 0 && afterClear.theme.threshold === 3 && afterClear.theme.theme === 'system');

    // 15. Themes
    await page.click('[data-section="settings"]');
    await sleep(200);
    await page.check('input[name="theme"][value="dark"]');
    await sleep(300);
    check('15a dark theme applied and persisted', await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark' &&
      JSON.parse(localStorage.getItem('shelflife-settings-v1')).theme === 'dark'));
    await page.check('input[name="theme"][value="light"]');
    await sleep(300);
    check('15b light theme applied', await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light'));
    await page.check('input[name="theme"][value="system"]');
    await sleep(200);

    // 16. Offline: reload offline, app loads and saves
    await page.reload({ waitUntil: 'load' });
    await sleep(800);
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' }).catch(() => {});
    await sleep(800);
    const offlineLoaded = await page.evaluate(() => document.getElementById('dashboard-heading') !== null && document.body.textContent.includes('Keep food fresh'));
    check('16a app loads offline after first visit', offlineLoaded);
    if (offlineLoaded) {
      await addProduct(page, { name: 'Offline Oats', category: 'Pantry', location: 'Pantry', opened: dateStr(0), days: 30 });
      check('16b can add product while offline', (await dbCount(page)) === 1);
    }
    await context.setOffline(false);
    await page.reload({ waitUntil: 'load' });
    await sleep(600);

    // 17. Mobile responsiveness at 5 widths
    let overflowOk = true, overflowAt = '';
    for (const w of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await sleep(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) { overflowOk = false; overflowAt += w + ':' + overflow + ' '; }
    }
    check('17 no horizontal overflow at 320/375/768/1024/1440', overflowOk, overflowAt);
    await page.setViewportSize({ width: 375, height: 800 });
    await sleep(300);
    check('17b bottom nav visible at 375px', await page.isVisible('.bottom-nav'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await sleep(300);

    // 18. Privacy: no remote requests
    const external = requests.filter(u => !u.startsWith('http://127.0.0.1:' + PORT) && !u.startsWith('data:') && !u.startsWith('blob:'));
    check('18 zero external requests', external.length === 0, external.slice(0, 3).join(', '));

    // 19. IndexedDB failure shows a visible error, not false success
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
    await page2.goto(BASE, { waitUntil: 'load' });
    await sleep(800);
    const errShown = await page2.evaluate(() => {
      const b = document.getElementById('db-error');
      return !b.hidden && b.textContent.length > 0;
    });
    check('19 IndexedDB failure shows visible error', errShown);
    await ctx2.close();

    // 20. Console health
    check('20 zero page errors / console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    // Extra: form validation keeps form open with inline errors
    await page.click('#add-product-btn');
    await sleep(300);
    await page.fill('#field-name', 'Bad Item');
    await page.selectOption('#field-category', 'Dairy');
    await page.selectOption('#field-location', 'Refrigerator');
    await page.fill('#field-opened', dateStr(0));
    await page.fill('#field-days', '5');
    await page.fill('#field-expiry', dateStr(-5));
    await page.click('#product-save-btn');
    await sleep(400);
    const stillOpen = await page.evaluate(() => document.getElementById('product-dialog').open);
    const errText = await page.textContent('#err-expiry');
    check('extra expiry before opened rejected, form preserved', stillOpen && errText.includes('cannot be earlier') && (await dbCount(page)) === 1);
    await page.keyboard.press('Escape');
    await sleep(300);
  } catch (e) {
    fail++;
    failures.push('exception: ' + e.message);
    console.log('EXCEPTION: ' + (e.stack || e.message));
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    server.close();
  }
  console.log('\nTOTAL: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) console.log('FAILED: ' + failures.join(' | '));
  process.exit(fail ? 1 : 0);
})();
