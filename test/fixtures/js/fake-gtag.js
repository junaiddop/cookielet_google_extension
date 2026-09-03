/**
 * Minimal stand-in for gtag.js used by the e2e fixtures.
 * Reproduces the observable behaviour the inspector relies on:
 *  - window.google_tag_data.ics with entries/flags (usedDefault, usedUpdate, wasSetLate, waitPeriodTimedOut, active)
 *  - processing of dataLayer commands: consent default/update, config, js
 *  - google_tag_data.tidr.container registration and google_tag_manager container keys
 *  - measurement hits to www.google-analytics.com/g/collect carrying gcs / gcd (+ gcu on the update hit)
 * The encoders follow the real gtag.js formula (see src/shared/gcm/gcd_parser.js).
 */
(function () {
  var B64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
  var TYPES = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization', 'functionality_storage', 'personalization_storage', 'security_storage'];
  var ORDER = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];
  var gtd = window.google_tag_data = window.google_tag_data || {};
  var ics = gtd.ics = gtd.ics || { entries: {}, active: false, usedDefault: false, usedUpdate: false, usedDeclare: false, usedImplicit: true, accessedDefault: false, accessedAny: false, wasSetLate: false, waitPeriodTimedOut: false, listeners: [] };
  gtd.tidr = gtd.tidr || { container: {}, destination: {}, destinationArray: {}, canonical: {}, pending: [] };
  window.google_tag_manager = window.google_tag_manager || {};
  var hits = 0;
  var noConsentMode = /noconsent=1/.test(location.search);

  ORDER.forEach(function (t) { ics.entries[t] = ics.entries[t] || { implicit: true }; });

  function entry(t) { return ics.entries[t] = ics.entries[t] || {}; }
  function state(t) { var e = ics.entries[t]; if (!e) return 0; if (e.update != null) return e.update ? 1 : 2; if (e.default != null) return e.default ? 1 : 2; if (e.implicit != null) return e.implicit ? 3 : 4; return 0; }
  function au(v) { return v === undefined ? 1 : v === true ? 3 : v === false ? 2 : 0; }
  function gcd() {
    var s = '1';
    ORDER.forEach(function (t) { var e = entry(t); s += B64[au(e.implicit)] + B64[(au(e.declare) << 4) | (au(e.default) << 2) | au(e.update)]; });
    s += B64[(ics.active ? 4 : 0) | 1] + 'l1';
    return s;
  }
  function gcs() {
    function d(t) { var st = state(t); return st === 1 ? '1' : (st === 2 || st === 4) ? '0' : '-'; }
    return 'G1' + d('ad_storage') + d('analytics_storage');
  }
  function sendHit(extra) {
    hits++;
    ics.accessedAny = true;
    var params = 'v=2&tid=G-TEST&cid=1.1&en=page_view&gcd=' + gcd() + '&npa=' + (state('ad_personalization') === 1 ? '0' : '1') + '&dma=1&dma_cps=' + (state('ad_user_data') === 1 ? 'a' : '-') + (extra || '');
    var active = ics.active || state('ad_storage') !== 1 || state('analytics_storage') !== 1;
    if (active) params += '&gcs=' + gcs();
    if (typeof window.__tcfapi === 'function') params += '&tcfd=17T53';
    var img = new Image();
    img.src = 'https://www.google-analytics.com/g/collect?' + params + '&_z=' + hits;
    window.__fakeGtagHits = (window.__fakeGtagHits || []).concat(img.src);
  }

  function consentDefault(params) {
    if (!ics.usedDefault && !ics.usedDeclare && (ics.accessedDefault || ics.accessedAny)) ics.wasSetLate = true;
    ics.usedDefault = true; ics.active = true;
    TYPES.forEach(function (t) { if (params[t] === 'granted' || params[t] === 'denied') { var e = entry(t); e.default = params[t] === 'granted'; if (params.region) e.region = String(Array.isArray(params.region) ? params.region[0] : params.region).toUpperCase(); if (params.wait_for_update > 0) e.quiet = true; } });
    if (params.wait_for_update > 0) setTimeout(function () { TYPES.forEach(function (t) { var e = ics.entries[t]; if (e && e.quiet) { ics.waitPeriodTimedOut = true; e.quiet = false; } }); }, Number(params.wait_for_update));
  }
  function consentUpdate(params) {
    if (!ics.usedDefault && !ics.usedDeclare && !ics.usedUpdate && ics.accessedAny) ics.wasSetLate = true;
    ics.usedUpdate = true; ics.active = true;
    TYPES.forEach(function (t) { if (params[t] === 'granted' || params[t] === 'denied') { var e = entry(t); e.update = params[t] === 'granted'; e.quiet = false; } });
    setTimeout(function () { sendHit('&gcu=1&gcut=1.3.4'); }, 30);
  }
  function process(item) {
    if (!item || typeof item.length !== 'number') return;
    var a = Array.prototype.slice.call(item);
    if (a[0] === 'consent' && a[1] === 'default') consentDefault(a[2] || {});
    else if (a[0] === 'consent' && a[1] === 'update') consentUpdate(a[2] || {});
    else if (a[0] === 'config' && typeof a[1] === 'string') {
      gtd.tidr.container[a[1]] = { state: 3 };
      window.google_tag_manager[a[1]] = { dataLayer: { name: 'dataLayer' }, bootstrap: Date.now() };
      if (!noConsentMode) { ics.accessedAny = true; }
      setTimeout(function () { sendHit(''); }, 20);
    }
  }

  var dl = window.dataLayer = window.dataLayer || [];
  for (var i = 0; i < dl.length; i++) process(dl[i]);
  var origPush = dl.push;
  dl.push = function () { var r = origPush.apply(this, arguments); for (var j = 0; j < arguments.length; j++) process(arguments[j]); return r; };
  window.__fakeGtagLoaded = true;
})();
