/**
 * Fake IAB TCF v2.2 CMP + GPP 1.1 CMP + Microsoft UET for the e2e fixtures.
 * Timeline: 0 ms IAB stub (__tcfapi queue + __tcfapiLocator frame) → 300 ms real CMP replaces the
 * stub (cmpStatus loaded, tcloaded) → 900 ms the "user accepts" (useractioncomplete + gtag consent
 * update + uetq consent update) → bat.js replaces uetq with a UET instance and sends beacons.
 */
(function () {
  var TC = 'CQoRCYAQoRCYAH3ABBENCuFoAPPAAEPgAAYgF5wA4AAgAEAAoBeYF5wAQF5gAAAA.IMzPx_G__bXlv-bb36btkeYxf9_hr7sQxBgbIsm4FzLvW7JwG32EbJEyatiIKmRIAu3DBIQNtHBjURUChKIAVrzDsaE2U4TtKJ-BkiHMZYytQCExvm4tjeQCZ4ur_90d0mR-t6dr-2dzy27hnn3a9fuS1UJydKYetHfv-ZhOS__IU9_x-_4v4_MbpEm0eSVv9tUtt4zc64v_6dpuxt-Tyff6f__f73fS7X__e__33_8qX3_r76-___3__v___ff_________9__-________wAAA.eAAAAAAAAAAA';
  var AC = '2~70.311~dv.1126';
  var listeners = {}, nextId = 1;
  var cmpStatus = 'stub', eventStatus = 'tcloaded', displayStatus = 'hidden';

  /* ---- IAB reference stub ---- */
  (function stub() {
    var queue = [];
    if (!window.frames['__tcfapiLocator']) {
      var f = document.createElement('iframe');
      f.style.cssText = 'display:none';
      f.setAttribute('name', '__tcfapiLocator');
      (document.body || document.head || document.documentElement).appendChild(f);
    }
    window.__tcfapi = function (cmd, version, cb) {
      if (cmd === 'ping') cb({ gdprApplies: undefined, cmpLoaded: false, cmpStatus: 'stub', displayStatus: 'hidden', apiVersion: '2.2', cmpVersion: undefined, cmpId: undefined, gvlVersion: undefined, tcfPolicyVersion: undefined }, true);
      else queue.push(arguments);
    };
    window.__tcfapi.a = queue;
  })();

  function tcData(extra) {
    var d = {
      tcString: TC, tcfPolicyVersion: 5, cmpId: 503, cmpVersion: 1, gdprApplies: true, eventStatus: eventStatus, cmpStatus: cmpStatus,
      isServiceSpecific: true, useNonStandardTexts: false, publisherCC: 'DE', purposeOneTreatment: false, addtlConsent: AC,
      purpose: { consents: { 1: true, 2: true, 3: true, 4: true, 7: true, 8: true, 9: true, 10: true }, legitimateInterests: { 2: true, 7: true, 8: true, 9: true, 10: true, 11: true } },
      vendor: { consents: { 1: true, 2: true, 3: true, 10: true, 755: true, 1000: true }, legitimateInterests: { 2: true, 755: true } },
      specialFeatureOptins: { 1: true }, publisher: { consents: { 1: true, 2: true }, legitimateInterests: {}, customPurpose: { consents: {}, legitimateInterests: {} }, restrictions: {} }
    };
    for (var k in extra) d[k] = extra[k];
    return d;
  }
  function notify() { Object.keys(listeners).forEach(function (id) { try { listeners[id](tcData({ listenerId: Number(id) }), true); } catch (e) { /* ignore */ } }); }

  function realCmp(cmd, version, cb, param) {
    switch (cmd) {
      case 'ping': return cb({ gdprApplies: true, cmpLoaded: true, cmpStatus: cmpStatus, displayStatus: displayStatus, apiVersion: '2.2', cmpVersion: 1, cmpId: 503, gvlVersion: 174, tcfPolicyVersion: 5 }, true);
      case 'addEventListener': { var id = nextId++; listeners[id] = cb; return cb(tcData({ listenerId: id }), true); }
      case 'removeEventListener': { var ok = !!listeners[param]; delete listeners[param]; return cb(ok, ok); }
      case 'getTCData': return cb(tcData({}), true);
      case 'getInAppTCData': return cb(tcData({}), true);
      case 'getVendorList': return cb({ vendorListVersion: 174, tcfPolicyVersion: 5, gvlSpecificationVersion: 3, vendors: { 1: { id: 1, name: 'V1' }, 755: { id: 755, name: 'Google' } } }, true);
      default: return cb(null, false);
    }
  }

  setTimeout(function () {
    cmpStatus = 'loaded';
    var queued = (window.__tcfapi && window.__tcfapi.a) || [];
    window.__tcfapi = realCmp;
    try { localStorage.setItem('IABTCF_TCString', TC); localStorage.setItem('IABTCF_CmpSdkID', '503'); localStorage.setItem('IABTCF_gdprApplies', '1'); localStorage.setItem('IABTCF_AddtlConsent', AC); } catch (e) { /* ignore */ }
    document.cookie = 'euconsent-v2=' + TC + '; path=/';
    for (var i = 0; i < queued.length; i++) realCmp.apply(null, queued[i]);
    window.addEventListener('message', function (ev) {
      var d = ev.data; try { if (typeof d === 'string') d = JSON.parse(d); } catch (e) { return; }
      if (d && d.__tcfapiCall) realCmp(d.__tcfapiCall.command, d.__tcfapiCall.version, function (ret, ok) { ev.source.postMessage({ __tcfapiReturn: { returnValue: ret, success: ok, callId: d.__tcfapiCall.callId } }, '*'); }, d.__tcfapiCall.parameter);
    });
  }, 300);

  /* ---- "user accepts" ---- */
  setTimeout(function () {
    eventStatus = 'useractioncomplete';
    notify();
    if (typeof window.gtag === 'function') window.gtag('consent', 'update', { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
    if (window.uetq && window.uetq.push) window.uetq.push('consent', 'update', { ad_storage: 'granted' });
  }, 900);

  /* ---- GPP 1.1 ---- */
  var gppListeners = {}, gppNext = 1, gppReady = false;
  var PING = { gppVersion: '1.1', cmpStatus: 'loaded', cmpDisplayStatus: 'hidden', signalStatus: 'not ready', supportedAPIs: ['2:tcfeuv2', '7:usnat'], cmpId: 503, sectionList: [2], applicableSections: [2], gppString: 'DBABMA~' + TC.split('.')[0], parsedSections: {} };
  window.__gpp = function (cmd, cb, param) {
    switch (cmd) {
      case 'ping': return cb(PING, true);
      case 'addEventListener': { var id = gppNext++; gppListeners[id] = cb; return cb({ eventName: 'listenerRegistered', listenerId: id, data: true, pingData: PING }, true); }
      case 'removeEventListener': { var ok = !!gppListeners[param]; delete gppListeners[param]; return cb(ok, true); }
      case 'hasSection': return cb(param === 'tcfeuv2', true);
      case 'getSection': return cb(null, true);
      case 'getField': return cb(null, true);
      default: return cb(null, false);
    }
  };
  setTimeout(function () {
    gppReady = true; PING.signalStatus = 'ready';
    Object.keys(gppListeners).forEach(function (id) { gppListeners[id]({ eventName: 'signalStatus', listenerId: Number(id), data: 'ready', pingData: PING }, true); });
  }, 500);
  void gppReady;

  /* ---- Microsoft UET ---- */
  window.uetq = window.uetq || [];
  window.uetq.push('consent', 'default', { ad_storage: 'denied' });
  setTimeout(function () {
    // bat.js replaces the queue array with a UET instance
    var queued = Array.isArray(window.uetq) ? window.uetq.slice() : [];
    var inst = { uetConfig: { consent: { enabled: true, adStorageAllowed: false, adStorageUpdated: false, waitForUpdate: 0, enforced: false }, tcf: { enabled: false, vendorId: 1126 }, enableAdStorage: false } };
    function beacon(evt) {
      var allowed = inst.uetConfig.consent.adStorageAllowed;
      var img = new Image();
      img.src = 'https://' + (allowed ? 'bat.bing.com' : 'bat.bing.net') + '/action/0?ti=1234567&Ver=2&mid=abc&evt=' + evt + '&asc=' + (allowed ? 'G' : 'D');
      window.__fakeUetBeacons = (window.__fakeUetBeacons || []).concat(img.src);
    }
    inst.push = function (a, b, c) {
      if (a === 'consent' && (b === 'default' || b === 'update') && c && c.ad_storage) {
        if (b === 'default' && inst.uetConfig.consent.adStorageUpdated) return;
        inst.uetConfig.consent.enabled = true;
        inst.uetConfig.consent.adStorageAllowed = c.ad_storage === 'granted';
        if (b === 'update') inst.uetConfig.consent.adStorageUpdated = true;
        inst.uetConfig.enableAdStorage = inst.uetConfig.consent.adStorageAllowed;
        beacon('consent&src=' + b);
      }
    };
    window.uetq = inst;
    for (var i = 0; i < queued.length; i++) { if (queued[i] === 'consent') { inst.push(queued[i], queued[i + 1], queued[i + 2]); i += 2; } }
    beacon('pageLoad');
  }, 400);
})();
