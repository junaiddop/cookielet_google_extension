/**
 * Cookielet Consent Inspector — page injector (MAIN world, classic script).
 *
 * Runs at document_start inside the page's own JavaScript world (manifest
 * "world": "MAIN"), before GTM / gtag / any CMP script. It has no chrome.* API
 * and runs under the PAGE's CSP, so it only installs property hooks and talks to
 * the isolated-world relay through window.postMessage.
 *
 * It is SILENT: nothing is written to the page console unless the relay's HELLO
 * carries debug:true (the extension's stored debug flag).
 *
 * Event names mirror src/shared/constants.js (EVT / POST_SOURCE*); a unit test
 * keeps the two in sync.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ constants */
  var SOURCE = 'COOKIELET_CMP_DEBUGGER';
  var HELLO = 'COOKIELET_CMP_DEBUGGER_HELLO';
  var READY = 'COOKIELET_CMP_DEBUGGER_READY';
  var CMD = 'COOKIELET_CMP_DEBUGGER_CMD';
  var GUARD = '__cookieletInspector';

  var SIGNALS = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization', 'functionality_storage', 'personalization_storage', 'security_storage'];
  var TAG_ID_RE = /^(G|AW|GTM|DC|UA|GT|MC)-[A-Z0-9]+$/i;
  var IABTCF_KEYS = ['IABTCF_CmpSdkID', 'IABTCF_CmpSdkVersion', 'IABTCF_PolicyVersion', 'IABTCF_gdprApplies', 'IABTCF_PublisherCC', 'IABTCF_PurposeOneTreatment',
    'IABTCF_UseNonStandardTexts', 'IABTCF_UseNonStandardStacks', 'IABTCF_TCString', 'IABTCF_VendorConsents', 'IABTCF_VendorLegitimateInterests', 'IABTCF_DisclosedVendors',
    'IABTCF_PurposeConsents', 'IABTCF_PurposeLegitimateInterests', 'IABTCF_SpecialFeaturesOptIns', 'IABTCF_PublisherConsent', 'IABTCF_PublisherLegitimateInterests',
    'IABTCF_PublisherCustomPurposesConsents', 'IABTCF_PublisherCustomPurposesLegitimateInterests', 'IABTCF_AddtlConsent'];
  var CMP_FINGERPRINTS = [
    ['Cookielet', function () { return !!(window.CMP && typeof window.CMP.getTCString === 'function') || !!document.querySelector('[id^="cl-t1"],[class*="cl-t1"]'); }],
    ['Cookiebot', function () { return !!window.Cookiebot; }],
    ['OneTrust', function () { return !!window.OneTrust; }],
    ['Usercentrics', function () { return !!window.UC_UI; }],
    ['Didomi', function () { return !!window.Didomi; }],
    ['Sourcepoint', function () { return !!window._sp_; }],
    ['CookieYes', function () { return !!(window.CookieYes || window.ckyConsent); }],
    ['Iubenda', function () { return !!window._iub; }],
    ['UniConsent', function () { return !!window.__unicapi; }],
    ['Quantcast Choice', function () { return !!window.__qcCmpApi || !!document.getElementById('qc-cmp2-container'); }],
    ['TrustArc', function () { return !!window.truste; }],
    ['Osano', function () { return !!window.Osano; }],
    ['Termly', function () { return !!window.Termly; }],
    ['CookieScript', function () { return !!window.CookieScript; }],
    ['Consentmanager', function () { return !!window.cmp_id || !!window.__cmp_id; }],
    ['Axeptio', function () { return !!window.axeptio; }],
    ['Klaro', function () { return !!window.klaro; }],
    ['Google Funding Choices', function () { return !!window.googlefc; }]
  ];

  /* ------------------------------------------------------------------ re-execution guard */
  var existing = null;
  try { existing = window[GUARD]; } catch (e) { /* ignore */ }
  if (existing && typeof existing.snapshot === 'function') {
    try { existing.snapshot({ replayed: true, manual: true, reason: 'reinject' }); } catch (e) { /* ignore */ }
    return;
  }

  /* ------------------------------------------------------------------ transport */
  var relayReady = false;
  var helloCount = 0;
  var debug = false;
  var queue = [];
  var installedAt = Date.now();

  function dbg() { if (!debug) return; try { console.log.apply(console, ['[Cookielet Inspector]'].concat([].slice.call(arguments))); } catch (e) { /* ignore */ } }

  function safeClone(data) {
    try { return data === undefined ? null : JSON.parse(JSON.stringify(data)); } catch (e) { return { serializationError: String(e) }; }
  }
  function post(msg) { try { window.postMessage(msg, '*'); } catch (e) { /* detached window */ } }
  function send(type, data) {
    var msg = { source: SOURCE, payload: { type: type, data: safeClone(data), timestamp: Date.now() } };
    dbg('event', type, msg.payload.data);
    if (relayReady) post(msg);
    else if (queue.length < 500) queue.push(msg);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data) return;
    if (event.data.source === HELLO) {
      relayReady = true;
      helloCount++;
      if (event.data.debug === true) debug = true;
      var pending = queue; queue = [];
      for (var i = 0; i < pending.length; i++) post(pending[i]);
      dbg('relay connected (#' + helloCount + '), flushed', pending.length);
      if (helloCount > 1 && booted) snapshot({ replayed: true, reason: 'hello' });
      return;
    }
    if (event.data.source === CMD && event.data.cmd === 'REPROBE') {
      dbg('REPROBE requested');
      snapshot({ replayed: true, manual: true, reason: 'reprobe' });
      reprobeApis();
    }
  });

  /* ------------------------------------------------------------------ dataLayer hook */
  var dlCurrent;             // the value the page assigned (undefined until it does)
  var dlDefined = false;
  var dlNonArray = false;
  var hookedArrays = [];

  function isArgsLike(item) {
    return !!item && typeof item === 'object' && typeof item.length === 'number' && typeof item !== 'string' && !(item instanceof Node);
  }
  function toArr(a) { try { return Array.prototype.slice.call(a); } catch (e) { return []; } }

  function inspectDLItem(item, dlIndex, replayed) {
    try {
      if (!item) return;
      if (isArgsLike(item)) {
        var arr = toArr(item);
        if (arr[0] === 'consent' && (arr[1] === 'default' || arr[1] === 'update' || arr[1] === 'declare')) {
          send('CONSENT_MODE_EVENT', { command: arr[1], params: arr[2] && typeof arr[2] === 'object' ? arr[2] : {}, dlIndex: dlIndex, replayed: !!replayed });
          if (!replayed) { scheduleIcs(0); scheduleIcs(120); scheduleIcs(700); }
        } else if (arr[0] === 'set') {
          var flags = {};
          if (typeof arr[1] === 'string' && (arr[1] === 'ads_data_redaction' || arr[1] === 'url_passthrough' || /^developer_id\./.test(arr[1]))) flags[arr[1]] = arr[2];
          else if (arr[1] && typeof arr[1] === 'object') {
            if ('ads_data_redaction' in arr[1]) flags.ads_data_redaction = arr[1].ads_data_redaction;
            if ('url_passthrough' in arr[1]) flags.url_passthrough = arr[1].url_passthrough;
          }
          if (Object.keys(flags).length) send('CONSENT_MODE_EVENT', { command: 'set', params: flags, dlIndex: dlIndex, replayed: !!replayed });
        } else if (arr[0] === 'config' && typeof arr[1] === 'string') {
          send('DL_EVENT', { kind: 'config', tagId: arr[1], dlIndex: dlIndex, replayed: !!replayed });
        } else if (arr[0] === 'js') {
          send('DL_EVENT', { kind: 'js', dlIndex: dlIndex, replayed: !!replayed });
        }
      } else if (typeof item === 'object' && typeof item.event === 'string' && /^gtm\.(js|dom|load)$/.test(item.event)) {
        send('DL_EVENT', { kind: item.event, dlIndex: dlIndex, replayed: !!replayed });
      }
    } catch (e) { /* never break the page */ }
  }

  var pushDepth = 0; // gtag/GTM wrap push and call the previous push (ours) from inside → inspect once only
  function wrapPush(orig) {
    var fn = typeof orig === 'function' ? orig : Array.prototype.push;
    var wrapped = function () {
      if (pushDepth === 0) {
        var base = (this && typeof this.length === 'number') ? this.length : null;
        for (var i = 0; i < arguments.length; i++) inspectDLItem(arguments[i], base == null ? null : base + i, false);
      }
      pushDepth++;
      try { return fn.apply(this, arguments); } finally { pushDepth--; }
    };
    wrapped.__cookieletWrapped = true;
    return wrapped;
  }

  function protectPush(obj) {
    var current = wrapPush(obj.push);
    try {
      Object.defineProperty(obj, 'push', {
        configurable: true, enumerable: false,
        get: function () { return current; },
        set: function (fn) { current = (fn && fn.__cookieletWrapped) ? fn : wrapPush(fn); }
      });
    } catch (e) {
      try { obj.push = current; } catch (e2) { /* frozen */ }
    }
  }

  function hookDataLayerArray(arr, replayAll) {
    if (!arr || arr.__cookieletHooked) { if (replayAll && arr) replayArray(arr); return; }
    try { Object.defineProperty(arr, '__cookieletHooked', { value: true, enumerable: false, configurable: true }); } catch (e) { /* ignore */ }
    hookedArrays.push(arr);
    replayArray(arr);
    protectPush(arr);
  }
  function replayArray(arr) {
    try { for (var i = 0; i < arr.length; i++) inspectDLItem(arr[i], i, true); } catch (e) { /* ignore */ }
  }

  function adoptDataLayerValue(v) {
    dlCurrent = v;
    if (v == null) return;
    dlDefined = true;
    if (Array.isArray(v)) { dlNonArray = false; hookDataLayerArray(v, false); }
    else if (typeof v === 'object' && typeof v.push === 'function') { dlNonArray = true; if (!v.__cookieletHooked) { try { Object.defineProperty(v, '__cookieletHooked', { value: true, enumerable: false }); } catch (e) { /* ignore */ } protectPush(v); } }
  }

  function hookDataLayer() {
    var desc = null;
    try { desc = Object.getOwnPropertyDescriptor(window, 'dataLayer'); } catch (e) { /* ignore */ }
    var initial;
    try { initial = window.dataLayer; } catch (e) { initial = undefined; }
    if (desc && !desc.configurable) { adoptDataLayerValue(initial); return; } // page declared `var dataLayer` before a late injection
    try {
      Object.defineProperty(window, 'dataLayer', {
        configurable: true, enumerable: true,
        get: function () { return dlCurrent; },
        set: function (v) { adoptDataLayerValue(v); }
      });
      if (initial !== undefined) adoptDataLayerValue(initial);
    } catch (e) {
      adoptDataLayerValue(initial);
    }
  }
  hookDataLayer();

  function hookCustomDataLayers() {
    try {
      var gtm = window.google_tag_manager;
      if (!gtm || typeof gtm !== 'object') return;
      var keys = Object.keys(gtm);
      for (var i = 0; i < keys.length; i++) {
        var entry = gtm[keys[i]];
        var name = entry && entry.dataLayer && typeof entry.dataLayer.name === 'string' ? entry.dataLayer.name : null;
        if (name && name !== 'dataLayer' && Array.isArray(window[name])) hookDataLayerArray(window[name], false);
      }
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ uetq hook (Microsoft UET) */
  var uetCurrent;
  var uetKind = null;
  var lastUetConfig = '';

  function inspectUet(args, replayed) {
    try {
      var a = toArr(args);
      if (a[0] === 'consent' && (a[1] === 'default' || a[1] === 'update') && a[2] && typeof a[2] === 'object') {
        send('UET_EVENT', { command: a[1], params: { ad_storage: a[2].ad_storage, wait_for_update: a[2].wait_for_update, source: a[2].source }, replayed: !!replayed });
      }
    } catch (e) { /* ignore */ }
  }
  var uetDepth = 0;
  function replayUetArray(v) {
    for (var i = 0; i < v.length; i++) {
      if (isArgsLike(v[i])) { inspectUet(v[i], true); continue; }
      if (v[i] === 'consent' && (v[i + 1] === 'default' || v[i + 1] === 'update') && v[i + 2] && typeof v[i + 2] === 'object') { inspectUet([v[i], v[i + 1], v[i + 2]], true); i += 2; }
    }
  }
  function wrapUetPush(orig) {
    var fn = typeof orig === 'function' ? orig : Array.prototype.push;
    var wrapped = function () {
      if (uetDepth === 0) {
        if (arguments.length && typeof arguments[0] === 'string') inspectUet(arguments, false); // push('consent','update',{...}) on the array or the UET instance
        else for (var i = 0; i < arguments.length; i++) { if (isArgsLike(arguments[i])) inspectUet(arguments[i], false); }
      }
      uetDepth++;
      var r;
      try { r = fn.apply(this, arguments); } finally { uetDepth--; }
      readUetConfig();
      return r;
    };
    wrapped.__cookieletWrapped = true;
    return wrapped;
  }
  function readUetConfig() {
    try {
      var u = uetCurrent;
      if (!u || typeof u !== 'object' || Array.isArray(u) || !u.uetConfig) return;
      var c = u.uetConfig.consent || null, t = u.uetConfig.tcf || null;
      var cfg = {
        consent: c ? { enabled: c.enabled, adStorageAllowed: c.adStorageAllowed, adStorageUpdated: c.adStorageUpdated, waitForUpdate: c.waitForUpdate, enforced: c.enforced } : null,
        tcf: t ? { enabled: t.enabled, vendorId: t.vendorId, hasVendor: t.hasVendor, auto: t.auto, gdprApplies: t.gdprApplies, adStorageAllowed: t.adStorageAllowed, measurementAllowed: t.measurementAllowed, personalizationAllowed: t.personalizationAllowed } : null,
        enableAdStorage: u.uetConfig.enableAdStorage
      };
      var s = JSON.stringify(cfg);
      if (s !== lastUetConfig) { lastUetConfig = s; send('UET_STATE', { kind: 'object', config: cfg }); }
    } catch (e) { /* ignore */ }
  }
  function adoptUet(v) {
    uetCurrent = v;
    if (v == null) return;
    if (Array.isArray(v)) {
      uetKind = 'array';
      if (!v.__cookieletHooked) {
        try { Object.defineProperty(v, '__cookieletHooked', { value: true, enumerable: false }); } catch (e) { /* ignore */ }
        replayUetArray(v);
        var current = wrapUetPush(v.push);
        try { Object.defineProperty(v, 'push', { configurable: true, enumerable: false, get: function () { return current; }, set: function (fn) { current = fn && fn.__cookieletWrapped ? fn : wrapUetPush(fn); } }); } catch (e) { try { v.push = current; } catch (e2) { /* ignore */ } }
      }
      send('UET_API_FOUND', { api: true, kind: 'array' });
    } else if (typeof v === 'object' && typeof v.push === 'function') {
      uetKind = 'object';
      if (!v.__cookieletHooked) {
        try { Object.defineProperty(v, '__cookieletHooked', { value: true, enumerable: false }); } catch (e) { /* ignore */ }
        var cur = wrapUetPush(v.push);
        try { Object.defineProperty(v, 'push', { configurable: true, enumerable: false, get: function () { return cur; }, set: function (fn) { cur = fn && fn.__cookieletWrapped ? fn : wrapUetPush(fn); } }); } catch (e) { try { v.push = cur; } catch (e2) { /* ignore */ } }
      }
      send('UET_API_FOUND', { api: true, kind: 'object' });
      readUetConfig();
    }
  }
  function hookUet() {
    var desc = null, initial;
    try { desc = Object.getOwnPropertyDescriptor(window, 'uetq'); } catch (e) { /* ignore */ }
    try { initial = window.uetq; } catch (e) { initial = undefined; }
    if (desc && !desc.configurable) { adoptUet(initial); return; }
    try {
      Object.defineProperty(window, 'uetq', { configurable: true, enumerable: true, get: function () { return uetCurrent; }, set: function (v) { adoptUet(v); } });
      if (initial !== undefined) adoptUet(initial);
    } catch (e) { adoptUet(initial); }
  }
  hookUet();

  /* ------------------------------------------------------------------ google_tag_data.ics */
  var lastIcs = '';
  var icsTimers = [];
  function readIcs() {
    try {
      var gtd = window.google_tag_data;
      var ics = gtd && gtd.ics;
      if (!ics || typeof ics !== 'object') return null;
      var entries = {};
      var src = ics.entries || {};
      var keys = SIGNALS.slice();
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k) && keys.indexOf(k) < 0) keys.push(k);
      for (var i = 0; i < keys.length; i++) {
        var e = src[keys[i]];
        if (!e) continue;
        entries[keys[i]] = { default: e.default, update: e.update, declare: e.declare, implicit: e.implicit, quiet: e.quiet, region: e.region, declare_region: e.declare_region };
      }
      return { active: ics.active, usedDefault: ics.usedDefault, usedUpdate: ics.usedUpdate, usedDeclare: ics.usedDeclare, usedImplicit: ics.usedImplicit,
        wasSetLate: ics.wasSetLate, waitPeriodTimedOut: ics.waitPeriodTimedOut, accessedAny: ics.accessedAny, accessedDefault: ics.accessedDefault, entries: entries };
    } catch (e) { return null; }
  }
  function snapshotIcs(force) {
    var s = readIcs();
    if (!s) return;
    var j = JSON.stringify(s);
    if (force || j !== lastIcs) { lastIcs = j; send('GCM_ICS', s); }
  }
  function scheduleIcs(ms) { icsTimers.push(setTimeout(function () { snapshotIcs(false); }, ms)); }

  /* ------------------------------------------------------------------ diagnostics */
  var lastDiagHash = '';
  function frameNamed(name) {
    try { if (window.frames[name]) return true; } catch (e) { /* cross-origin access to frames map is fine, but guard anyway */ }
    try { return document.getElementsByName(name).length > 0; } catch (e) { return false; }
  }
  function detectCmp() {
    for (var i = 0; i < CMP_FINGERPRINTS.length; i++) { try { if (CMP_FINGERPRINTS[i][1]()) return { name: CMP_FINGERPRINTS[i][0] }; } catch (e) { /* ignore */ } }
    return null;
  }
  function collectTagIds() {
    var ids = {}, out = [];
    function add(id, source) { id = String(id); if (TAG_ID_RE.test(id) && !ids[id]) { ids[id] = true; out.push({ id: id, source: source }); } }
    try { var dl = dlCurrent; if (Array.isArray(dl)) for (var i = 0; i < dl.length; i++) { var it = dl[i]; if (isArgsLike(it) && it[0] === 'config' && typeof it[1] === 'string') add(it[1], 'dataLayer'); } } catch (e) { /* ignore */ }
    try { var tidr = window.google_tag_data && window.google_tag_data.tidr; if (tidr) { ['container', 'destination', 'destinationArray'].forEach(function (m) { if (tidr[m]) Object.keys(tidr[m]).forEach(function (k) { add(k, 'tidr.' + m); }); }); } } catch (e) { /* ignore */ }
    try { var gtm = window.google_tag_manager; if (gtm) Object.keys(gtm).forEach(function (k) { add(k, 'google_tag_manager'); }); } catch (e) { /* ignore */ }
    return out;
  }
  function collectDiagnostics() {
    var d = {
      tcfApi: typeof window.__tcfapi === 'function', tcfLocator: frameNamed('__tcfapiLocator'),
      gppApi: typeof window.__gpp === 'function', gppLocator: frameNamed('__gppLocator'),
      gtagFn: typeof window.gtag === 'function', dataLayer: dlDefined, dataLayerNonArray: dlNonArray,
      gtagData: !!window.google_tag_data, gcmActive: !!(window.google_tag_data && window.google_tag_data.ics && window.google_tag_data.ics.active),
      gtagTcfSupport: window.gtag_enable_tcf_support === true, gtmTcf: null, tagIds: collectTagIds(), adsActive: false, gtagLoaded: false, gtmLoaded: false,
      gtmContainers: [], cmp: detectCmp(), uetq: uetKind, gpc: !!(navigator && navigator.globalPrivacyControl), prerendered: wasPrerendered, restored: wasRestored
    };
    try { var t = window.google_tag_manager && window.google_tag_manager.tcf; if (t && typeof t === 'object') d.gtmTcf = { active: !!t.active, cmpId: t.cmpId, tcfPolicyVersion: t.tcfPolicyVersion, gdprApplies: t.gdprApplies, tcString: typeof t.tcString === 'string' ? t.tcString.slice(0, 40) : null, enableAdvertiserConsentMode: t.enableAdvertiserConsentMode }; } catch (e) { /* ignore */ }
    for (var i = 0; i < d.tagIds.length; i++) {
      var id = d.tagIds[i].id.toUpperCase();
      if (id.indexOf('AW-') === 0) d.adsActive = true;
      if (id.indexOf('G-') === 0 || id.indexOf('UA-') === 0 || id.indexOf('GT-') === 0) d.gtagLoaded = true;
      if (id.indexOf('GTM-') === 0) { d.gtmLoaded = true; d.gtmContainers.push(d.tagIds[i].id); }
    }
    return d;
  }
  function snapshotDiagnostics(force) {
    var d = collectDiagnostics();
    var hash = JSON.stringify(d);
    if (force || hash !== lastDiagHash) { lastDiagHash = hash; send('DIAGNOSTICS', d); }
    return d;
  }

  /* ------------------------------------------------------------------ IAB TCF */
  var tcfFn = null;            // identity of window.__tcfapi we probed last
  var tcfProxy = null;         // postMessage proxy when only the locator frame exists
  var tcfApiAnnounced = '';
  var tcfListenerId = null;
  var tcfPingSig = '';
  var tcfLoaded = false;
  var tcfPingTries = 0;
  var lastStorage = '';
  var removeProbeOk = false;

  function announceTcf() {
    var api = typeof window.__tcfapi === 'function', locator = frameNamed('__tcfapiLocator');
    var sig = api + '|' + locator + '|' + !!tcfProxy;
    if (sig !== tcfApiAnnounced) { tcfApiAnnounced = sig; send('TCF_API_FOUND', { api: api, locator: locator, viaPostMessage: !api && !!tcfProxy }); }
  }
  function withTimeout(command, ms, run) {
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; send('TCF_COMMAND', { command: command, ok: false, note: 'no callback within ' + ms + ' ms' }); } }, ms);
    try {
      run(function () { if (done) return false; done = true; clearTimeout(timer); return true; });
    } catch (e) {
      if (!done) { done = true; clearTimeout(timer); send('TCF_COMMAND', { command: command, ok: false, note: 'threw: ' + String(e && e.message || e) }); send('TCF_ERROR', { where: command, message: String(e && e.message || e) }); }
    }
  }
  function currentTcf() { return typeof window.__tcfapi === 'function' ? window.__tcfapi : tcfProxy; }

  function tcfPing(force) {
    var fn = currentTcf();
    if (!fn) return;
    try {
      fn('ping', 2, function (p, success) {
        if (!p || typeof p !== 'object') { send('TCF_COMMAND', { command: 'ping', ok: false, note: 'no ping object' }); return; }
        var sig = [p.cmpStatus, p.cmpLoaded, p.displayStatus, p.gdprApplies, p.cmpId, p.gvlVersion, p.tcfPolicyVersion].join('|');
        if (force || sig !== tcfPingSig) {
          tcfPingSig = sig;
          send('TCF_PING', p);
          send('TCF_COMMAND', { command: 'ping', ok: typeof p.cmpStatus === 'string' && typeof p.cmpLoaded === 'boolean', note: success === false ? 'success=false' : null });
        }
        if (p.cmpStatus === 'loaded' && !tcfLoaded) { tcfLoaded = true; probeOptionalTcf(fn); if (!removeProbeOk) probeRemoveListener(fn); }
      });
    } catch (e) { send('TCF_ERROR', { where: 'ping', message: String(e && e.message || e) }); }
  }

  function probeTcf(fn) {
    tcfFn = fn;
    tcfLoaded = false;
    tcfPingTries = 0;
    announceTcf();
    tcfPing(true);
    // addEventListener — the long-lived subscription
    withTimeout('addEventListener', 8000, function (settle) {
      fn('addEventListener', 2, function (tcData, success) {
        if (settle()) send('TCF_COMMAND', { command: 'addEventListener', ok: success !== false && !!tcData && typeof tcData === 'object', note: null });
        if (success !== false && tcData && typeof tcData === 'object') {
          if (tcData.listenerId != null) tcfListenerId = tcData.listenerId;
          send('TCF_DATA', tcData);
          snapshotStorage(false);
          scheduleIcs(50); scheduleIcs(600);
        } else send('TCF_ERROR', { where: 'addEventListener', message: 'callback success=false' });
      });
    });
    probeRemoveListener(fn);
    // getTCData — deprecated in v2.2, still informative
    withTimeout('getTCData', 5000, function (settle) {
      fn('getTCData', 2, function (tcData, success) {
        if (settle()) send('TCF_COMMAND', { command: 'getTCData', ok: success !== false && !!tcData && typeof tcData === 'object', note: 'deprecated in TCF v2.2' });
        if (success !== false && tcData && typeof tcData === 'object' && !tcfListenerId) send('TCF_DATA', tcData);
      });
    });
  }
  // removeEventListener — register a throwaway listener and remove it by its listenerId
  function probeRemoveListener(fn) {
    withTimeout('removeEventListener', 8000, function (settle) {
      var handled = false;
      fn('addEventListener', 2, function (tcData, success) {
        if (handled) return; // the throwaway listener may fire again before removal completes
        handled = true;
        var lid = tcData && tcData.listenerId != null ? tcData.listenerId : tcfListenerId;
        if (!success || lid == null) { if (settle()) send('TCF_COMMAND', { command: 'removeEventListener', ok: false, note: 'no listenerId to remove' }); return; }
        try {
          fn('removeEventListener', 2, function (ret, ok) {
            var good = ret === true || (ret === undefined && ok === true) || ok === true;
            if (good) removeProbeOk = true;
            if (settle()) send('TCF_COMMAND', { command: 'removeEventListener', ok: good, note: good ? null : 'callback returned ' + String(ret) + ' / success ' + String(ok) });
          }, lid);
        } catch (e) { if (settle()) send('TCF_COMMAND', { command: 'removeEventListener', ok: false, note: 'threw: ' + String(e && e.message || e) }); }
      });
    });
  }
  function probeOptionalTcf(fn) {
    withTimeout('getInAppTCData', 5000, function (settle) {
      fn('getInAppTCData', 2, function (d, success) { if (settle()) send('TCF_COMMAND', { command: 'getInAppTCData', ok: success !== false && !!d && typeof d === 'object', note: 'optional' }); });
    });
    withTimeout('getVendorList', 15000, function (settle) {
      fn('getVendorList', 2, function (gvl, success) {
        if (!settle()) return;
        var ok = success !== false && !!gvl && typeof gvl === 'object' && !!gvl.vendors;
        send('TCF_COMMAND', { command: 'getVendorList', ok: ok, note: ok ? { vendorListVersion: gvl.vendorListVersion, tcfPolicyVersion: gvl.tcfPolicyVersion, gvlSpecificationVersion: gvl.gvlSpecificationVersion, vendorCount: Object.keys(gvl.vendors).length } : 'optional' });
      });
    });
  }

  // postMessage proxy for locator-only pages (CMP API v2.2 §"Cross-frame")
  function makeTcfProxy() {
    var target = null;
    var w = window;
    for (var hops = 0; hops < 20 && w; hops++) {
      try { if (w.frames['__tcfapiLocator']) { target = w; break; } } catch (e) { /* cross-origin */ }
      if (w === window.top) break;
      w = w.parent;
    }
    if (!target) return null;
    var callbacks = {};
    window.addEventListener('message', function (ev) {
      var data = ev.data;
      try { if (typeof data === 'string') data = JSON.parse(data); } catch (e) { return; }
      var ret = data && data.__tcfapiReturn;
      if (!ret || !callbacks[ret.callId]) return;
      callbacks[ret.callId](ret.returnValue, ret.success);
      if (!(ret.returnValue && ret.returnValue.listenerId != null)) delete callbacks[ret.callId];
    }, false);
    return function (command, version, cb, param) {
      var callId = 'cl-' + Math.random().toString(36).slice(2);
      callbacks[callId] = cb;
      target.postMessage({ __tcfapiCall: { command: command, parameter: param, version: version, callId: callId } }, '*');
    };
  }

  function snapshotStorage(force) {
    try {
      var s = {};
      var any = false;
      for (var i = 0; i < IABTCF_KEYS.length; i++) { var v = window.localStorage.getItem(IABTCF_KEYS[i]); if (v != null) { s[IABTCF_KEYS[i]] = v; any = true; } }
      try { for (var j = 0; j < window.localStorage.length; j++) { var k = window.localStorage.key(j); if (k && k.indexOf('IABTCF_PublisherRestrictions') === 0) { s[k] = window.localStorage.getItem(k); any = true; } } } catch (e) { /* ignore */ }
      var m = document.cookie.match(/(?:^|;\s*)euconsent-v2=([^;]*)/);
      if (m) { s['cookie:euconsent-v2'] = decodeURIComponent(m[1]); any = true; }
      if (!any) return;
      var jsn = JSON.stringify(s);
      if (force || jsn !== lastStorage) { lastStorage = jsn; send('TCF_STORAGE', s); }
    } catch (e) { /* localStorage may be blocked */ }
  }

  function tickTcf() {
    var fn = typeof window.__tcfapi === 'function' ? window.__tcfapi : null;
    if (fn && fn !== tcfFn) { probeTcf(fn); return; }
    if (!fn && !tcfProxy && frameNamed('__tcfapiLocator')) {
      tcfProxy = makeTcfProxy();
      if (tcfProxy) probeTcf(tcfProxy);
      return;
    }
    if ((fn || tcfProxy) && !tcfLoaded && tcfPingTries < 120) { tcfPingTries++; tcfPing(false); }
    announceTcf();
  }

  /* ------------------------------------------------------------------ IAB GPP */
  var gppFn = null;
  var gppAnnounced = '';
  var gppReady = false;
  var gppPingTries = 0;
  var gppPingSig = '';
  var gppSectionsProbed = false;

  function announceGpp() {
    var api = typeof window.__gpp === 'function', locator = frameNamed('__gppLocator');
    var sig = api + '|' + locator;
    if (sig !== gppAnnounced) { gppAnnounced = sig; send('GPP_API_FOUND', { api: api, locator: locator }); }
  }
  function handleGppPing(p, force) {
    if (!p || typeof p !== 'object') return;
    var sig = [p.gppVersion, p.cmpStatus, p.cmpDisplayStatus, p.signalStatus, p.gppString, JSON.stringify(p.applicableSections)].join('|');
    if (force || sig !== gppPingSig) { gppPingSig = sig; send('GPP_PING', p); }
    if (p.signalStatus === 'ready' || (p.cmpStatus === 'loaded' && p.signalStatus == null)) gppReady = true;
    if (gppReady && !gppSectionsProbed) { gppSectionsProbed = true; probeGppSections(p); }
  }
  function gppPing(force) {
    var fn = gppFn;
    if (!fn) return;
    try {
      var calledBack = false;
      var r = fn('ping', function (p, success) { calledBack = true; if (success === false) send('GPP_ERROR', { where: 'ping', message: 'success=false' }); handleGppPing(p, force); });
      if (!calledBack && r && typeof r === 'object') handleGppPing(r, force); // GPP 1.0 returns synchronously
    } catch (e) { send('GPP_ERROR', { where: 'ping', message: String(e && e.message || e) }); }
  }
  function probeGppSections(ping) {
    var fn = gppFn;
    var apis = Array.isArray(ping.supportedAPIs) ? ping.supportedAPIs : [];
    for (var i = 0; i < apis.length; i++) {
      (function (entry) {
        var prefix = String(entry).indexOf(':') >= 0 ? String(entry).split(':')[1] : String(entry);
        try { fn('hasSection', function (has, success) { send('GPP_SECTION', { prefix: prefix, present: has === true, success: success !== false }); }, prefix); } catch (e) { send('GPP_ERROR', { where: 'hasSection:' + prefix, message: String(e && e.message || e) }); }
      })(apis[i]);
    }
  }
  function probeGpp(fn) {
    gppFn = fn; gppReady = false; gppPingTries = 0; gppSectionsProbed = false;
    announceGpp();
    gppPing(true);
    try {
      var lid = null;
      fn('addEventListener', function (evt, success) {
        if (success === false || !evt) { send('GPP_ERROR', { where: 'addEventListener', message: 'success=false' }); return; }
        if (evt.listenerId != null) lid = evt.listenerId;
        send('GPP_EVENT', { eventName: evt.eventName, listenerId: evt.listenerId, data: evt.data, pingData: evt.pingData });
        if (evt.eventName === 'listenerRegistered') send('GPP_COMMAND', { command: 'addEventListener', ok: true, note: null });
        if (evt.pingData) handleGppPing(evt.pingData, false);
      });
      // removeEventListener probe with a second, throwaway listener
      fn('addEventListener', function (evt, success) {
        if (success === false || !evt || evt.listenerId == null || evt.eventName !== 'listenerRegistered') return;
        var id = evt.listenerId;
        try { fn('removeEventListener', function (ok, success2) { send('GPP_COMMAND', { command: 'removeEventListener', ok: ok === true && success2 !== false, note: null }); }, id); }
        catch (e) { send('GPP_COMMAND', { command: 'removeEventListener', ok: false, note: String(e && e.message || e) }); }
      });
      void lid;
    } catch (e) { send('GPP_ERROR', { where: 'addEventListener', message: String(e && e.message || e) }); send('GPP_COMMAND', { command: 'addEventListener', ok: false, note: String(e && e.message || e) }); }
    try {
      var cb = false;
      var r = fn('getGPPData', function (d, success) { cb = true; if (success !== false && d) send('GPP_DATA', d); });
      if (!cb && r && typeof r === 'object') send('GPP_DATA', r);
    } catch (e) { /* removed in GPP 1.1 — expected */ }
  }
  function tickGpp() {
    var fn = typeof window.__gpp === 'function' ? window.__gpp : null;
    if (fn && fn !== gppFn) { probeGpp(fn); return; }
    if (fn && !gppReady && gppPingTries < 60) { gppPingTries++; gppPing(false); }
    announceGpp();
  }

  /* ------------------------------------------------------------------ history / bfcache / prerender */
  var wasPrerendered = false;
  var wasRestored = false;
  function hookHistory() {
    try {
      ['pushState', 'replaceState'].forEach(function (m) {
        var orig = history[m];
        if (typeof orig !== 'function') return;
        history[m] = function () {
          var r = orig.apply(this, arguments);
          urlChanged();
          return r;
        };
      });
      window.addEventListener('popstate', urlChanged);
      window.addEventListener('hashchange', urlChanged);
    } catch (e) { /* ignore */ }
  }
  var lastUrl = location.href;
  function urlChanged() {
    setTimeout(function () {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      send('URL_CHANGE', { url: location.href, dlIndex: Array.isArray(dlCurrent) ? dlCurrent.length : null });
      snapshotDiagnostics(false);
    }, 0);
  }

  /* ------------------------------------------------------------------ snapshot + boot */
  var booted = false;
  function snapshot(opts) {
    opts = opts || {};
    send('PAGE_INIT', { url: location.href, readyState: document.readyState, title: document.title, replayed: !!opts.replayed, manual: !!opts.manual, restored: !!opts.restored, reason: opts.reason || 'boot' });
    if (opts.replayed) {
      for (var i = 0; i < hookedArrays.length; i++) replayArray(hookedArrays[i]);
      if (dlNonArray && dlCurrent && typeof dlCurrent.length === 'number') { try { for (var j = 0; j < dlCurrent.length; j++) inspectDLItem(dlCurrent[j], j, true); } catch (e) { /* ignore */ } }
      if (uetKind === 'array' && Array.isArray(uetCurrent)) for (var k = 0; k < uetCurrent.length; k++) if (isArgsLike(uetCurrent[k])) inspectUet(uetCurrent[k], true);
    }
    snapshotDiagnostics(true);
    snapshotIcs(true);
    announceTcf(); announceGpp();
    if (opts.replayed) {
      var fn = currentTcf();
      if (fn) { tcfPing(true); try { fn('getTCData', 2, function (d, s) { if (s !== false && d && typeof d === 'object') send('TCF_DATA', d); }); } catch (e) { /* ignore */ } }
      if (gppFn) gppPing(true);
      if (uetKind === 'object') { lastUetConfig = ''; readUetConfig(); }
      snapshotStorage(true);
    }
  }
  function reprobeApis() {
    tcfFn = null; tcfLoaded = false; tcfPingSig = ''; gppFn = null; gppPingSig = '';
    tickTcf(); tickGpp();
  }

  function boot() {
    if (booted) return;
    booted = true;
    hookHistory();
    snapshot({ reason: 'boot' });
    tickTcf(); tickGpp(); hookCustomDataLayers();

    // fast tick: 500 ms for 60 s, then 2 s for 5 min; event-driven snapshots keep working afterwards
    var fastEnd = Date.now() + 60000, slowEnd = Date.now() + 300000;
    var timer = null;
    function tick() {
      try { tickTcf(); tickGpp(); snapshotIcs(false); snapshotDiagnostics(false); hookCustomDataLayers(); readUetConfig(); if (Date.now() - installedAt > 1500) snapshotStorage(false); } catch (e) { /* ignore */ }
      var now = Date.now();
      if (now > slowEnd) { timer = null; return; }
      timer = setTimeout(tick, now < fastEnd ? 500 : 2000);
    }
    timer = setTimeout(tick, 250);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { snapshotIcs(false); snapshotDiagnostics(false); tickTcf(); tickGpp(); } });
    window.addEventListener('load', function () { setTimeout(function () { tickTcf(); tickGpp(); snapshotIcs(false); snapshotDiagnostics(false); snapshotStorage(false); }, 100); });
    window.addEventListener('pageshow', function (ev) { if (ev.persisted) { wasRestored = true; snapshot({ replayed: true, restored: true, reason: 'bfcache' }); } });
    void timer;
  }

  try { Object.defineProperty(window, GUARD, { value: { snapshot: snapshot, version: 2 }, enumerable: false, configurable: true, writable: false }); } catch (e) { /* ignore */ }
  post({ source: READY });

  if (document.prerendering) {
    wasPrerendered = true;
    document.addEventListener('prerenderingchange', boot, { once: true });
  } else {
    boot();
  }
})();
