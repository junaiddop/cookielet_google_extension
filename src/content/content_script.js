/**
 * Cookielet Consent Inspector — isolated-world relay (classic script).
 *
 * Bridges the MAIN-world page_injector.js (window.postMessage) to the service
 * worker (chrome.runtime.sendMessage) and forwards worker commands back to the
 * page. Registers its runtime.onMessage listener synchronously. Silent unless
 * chrome.storage.local.debug is true.
 *
 * String literals mirror src/shared/constants.js (POST_SOURCE*, MSG.RECORD, MSG.PAGE_CMD).
 */
(function () {
  'use strict';

  var SOURCE = 'COOKIELET_CMP_DEBUGGER';
  var HELLO = 'COOKIELET_CMP_DEBUGGER_HELLO';
  var READY = 'COOKIELET_CMP_DEBUGGER_READY';
  var CMD = 'COOKIELET_CMP_DEBUGGER_CMD';
  var ACTION_RECORD = 'RECORD';
  var ACTION_PAGE_CMD = 'PAGE_CMD';

  var debug = false;
  var alive = true;
  var debugKnown = false;
  var readyPending = false;
  var helloSent = false;

  function sayHello() {
    helloSent = true;
    try { window.postMessage({ source: HELLO, debug: debug }, '*'); } catch (e) { /* ignore */ }
  }
  // startup HELLO: answer READY once the debug flag is known (or after 50 ms), never twice
  function startupHello() {
    if (helloSent) return;
    if (debugKnown) sayHello(); else readyPending = true;
  }

  // executeScript can re-run this file in a tab that already has the relay: just re-announce
  // (the injector answers a repeated HELLO with a full snapshot).
  if (window.__cookieletRelay) {
    window.__cookieletRelay.hello();
    return;
  }
  try { Object.defineProperty(window, '__cookieletRelay', { value: { hello: sayHello }, enumerable: false, configurable: true }); } catch (e) { window.__cookieletRelay = { hello: sayHello }; }

  function forward(payload) {
    if (!alive) return;
    try {
      chrome.runtime.sendMessage({ action: ACTION_RECORD, payload: payload }, function () {
        if (chrome.runtime.lastError) { /* worker asleep or gone — the record is best effort */ }
      });
    } catch (e) {
      alive = false; // extension reloaded/disabled while the page is alive
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data) return;
    if (event.data.source === READY) { if (helloSent) sayHello(); else startupHello(); return; }
    if (event.data.source !== SOURCE || !event.data.payload) return;
    if (debug) { try { console.log('[Cookielet Relay] →', event.data.payload.type); } catch (e) { /* ignore */ } }
    forward(event.data.payload);
  });

  // worker → page commands (registered synchronously; responds immediately)
  try {
    chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
      if (!message || message.action !== ACTION_PAGE_CMD) return undefined;
      try { window.postMessage({ source: CMD, cmd: message.cmd }, '*'); } catch (e) { /* ignore */ }
      sendResponse({ ok: true });
      return undefined;
    });
  } catch (e) { /* no runtime (should not happen in an isolated world) */ }

  // debug flag (best effort); the startup HELLO goes out once the flag is known or after 50 ms
  function flagKnown() { if (debugKnown) return; debugKnown = true; if (readyPending || !helloSent) { readyPending = false; if (!helloSent) sayHello(); } }
  try {
    chrome.storage.local.get('debug', function (r) {
      if (!chrome.runtime.lastError && r && r.debug === true) debug = true;
      flagKnown();
    });
    setTimeout(flagKnown, 50); // never keep the injector waiting
  } catch (e) {
    flagKnown();
  }
})();
