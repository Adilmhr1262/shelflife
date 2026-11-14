/* ShelfLife date utilities.
   All dates are local calendar dates in ISO YYYY-MM-DD form.
   Arithmetic uses calendar days, never milliseconds divided by 86400000,
   so results stay correct across daylight saving time changes. */
(function (global) {
  'use strict';

  var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function isValidISODate(value) {
    if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
    var parts = value.split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function parseDate(value) {
    if (!isValidISODate(value)) return null;
    var parts = value.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function toISODate(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function todayISO() {
    return toISODate(new Date());
  }

  /* Add n calendar days to an ISO date, return an ISO date. */
  function addDays(iso, n) {
    var dt = parseDate(iso);
    if (!dt) return null;
    dt.setDate(dt.getDate() + n);
    return toISODate(dt);
  }

  /* Whole calendar days from date a to date b (b minus a). Negative when b is earlier. */
  function daysBetween(aISO, bISO) {
    var a = parseDate(aISO);
    var b = parseDate(bISO);
    if (!a || !b) return null;
    var aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((bUtc - aUtc) / 86400000);
  }

  function formatDate(iso) {
    var dt = parseDate(iso);
    if (!dt) return iso;
    return dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
  }

  function isValidTimestamp(value) {
    if (typeof value !== 'string') return false;
    var t = Date.parse(value);
    return !isNaN(t);
  }

  global.ShelfLifeDates = {
    isValidISODate: isValidISODate,
    parseDate: parseDate,
    toISODate: toISODate,
    todayISO: todayISO,
    addDays: addDays,
    daysBetween: daysBetween,
    formatDate: formatDate,
    isValidTimestamp: isValidTimestamp
  };
})(typeof window !== 'undefined' ? window : globalThis);
