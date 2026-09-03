/**
 * Cookielet Consent Inspector — shared constants (ESM).
 *
 * The two content scripts (src/content/*.js) are classic scripts and cannot
 * import this module; they mirror the string literals below. A unit test
 * (test/unit/contract.test.js) asserts that every EVT / POST_SOURCE literal
 * appears verbatim in those files so the two sides cannot drift.
 */

/** Message actions between popup ⇄ service worker ⇄ content script. */
export const MSG = Object.freeze({
  RECORD: 'RECORD',                   // content → worker: {type, data, timestamp}
  GET_TAB_DATA: 'GET_TAB_DATA',       // popup → worker: {tabId}
  ENSURE_INJECTED: 'ENSURE_INJECTED', // popup → worker: {tabId}
  REPROBE: 'REPROBE',                 // popup → worker: {tabId}
  CLEAR_TAB: 'CLEAR_TAB',             // popup → worker: {tabId}
  GET_GVL: 'GET_GVL',                 // popup → worker: {version?, force?}
  GET_MANUAL: 'GET_MANUAL',           // popup → worker: {host}
  SET_MANUAL: 'SET_MANUAL',           // popup → worker: {host, checkId, value}
  SET_DEBUG: 'SET_DEBUG',             // popup → worker: {value}
  PAGE_CMD: 'PAGE_CMD'                // worker → content: {cmd}
});

/** Page-side commands carried by MSG.PAGE_CMD / POST_SOURCE_CMD. */
export const PAGE_CMDS = Object.freeze({ REPROBE: 'REPROBE' });

/** Event types produced by the MAIN-world page injector (payload.type). */
export const EVT = Object.freeze({
  PAGE_INIT: 'PAGE_INIT',
  URL_CHANGE: 'URL_CHANGE',
  DIAGNOSTICS: 'DIAGNOSTICS',
  CONSENT_MODE_EVENT: 'CONSENT_MODE_EVENT',
  DL_EVENT: 'DL_EVENT',
  GCM_ICS: 'GCM_ICS',
  TCF_API_FOUND: 'TCF_API_FOUND',
  TCF_PING: 'TCF_PING',
  TCF_DATA: 'TCF_DATA',
  TCF_COMMAND: 'TCF_COMMAND',
  TCF_ERROR: 'TCF_ERROR',
  TCF_STORAGE: 'TCF_STORAGE',
  GPP_API_FOUND: 'GPP_API_FOUND',
  GPP_PING: 'GPP_PING',
  GPP_EVENT: 'GPP_EVENT',
  GPP_DATA: 'GPP_DATA',
  GPP_ERROR: 'GPP_ERROR',
  GPP_COMMAND: 'GPP_COMMAND',
  GPP_SECTION: 'GPP_SECTION',
  UET_API_FOUND: 'UET_API_FOUND',
  UET_EVENT: 'UET_EVENT',
  UET_STATE: 'UET_STATE'
});

/** window.postMessage envelope sources (page ⇄ isolated relay). */
export const POST_SOURCE = 'COOKIELET_CMP_DEBUGGER';
export const POST_SOURCE_HELLO = 'COOKIELET_CMP_DEBUGGER_HELLO';
export const POST_SOURCE_READY = 'COOKIELET_CMP_DEBUGGER_READY';
export const POST_SOURCE_CMD = 'COOKIELET_CMP_DEBUGGER_CMD';

/** Google Consent Mode signal names (v2 first). */
export const GCM_SIGNALS = Object.freeze([
  'ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization',
  'functionality_storage', 'personalization_storage', 'security_storage'
]);
export const GCM_V2_REQUIRED = Object.freeze(['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization']);

/** TCF v2.2 CMP API commands probed by the injector (in probe order). */
export const TCF_COMMANDS = Object.freeze(['ping', 'addEventListener', 'removeEventListener', 'getTCData', 'getInAppTCData', 'getVendorList']);
export const TCF_REQUIRED_COMMANDS = Object.freeze(['ping', 'addEventListener', 'removeEventListener']);

/** Per-tab ring-buffer caps (keep storage.session well under quota). */
export const CAPS = Object.freeze({
  CONSENT_EVENTS: 200, DL_EVENTS: 200, ICS_HISTORY: 20, TCF_HISTORY: 50, TCF_ERRORS: 50,
  GPP_EVENTS: 100, UET_EVENTS: 50, UET_TAG_REQUESTS: 50, NETWORK_SIGNALS: 300
});

export const STATE_VERSION = 2;
export const COOKIELET_CMP_ID = 503;

/** TCF v2.2: consent older than 13 months must be re-collected. */
export const TCF_MAX_AGE_MS = 396 * 24 * 60 * 60 * 1000;
/** Current TCF policy version published with GVL v3 (tcfPolicyVersion in ping / TC string). Compare against the live GVL when available. */
export const TCF_CURRENT_POLICY_VERSION = 5;
/** TCF v2.3: DisclosedVendors segment mandatory, enforced from this date. */
export const TCF_V23_ENFORCEMENT_MS = Date.UTC(2026, 2, 1);
export const TCF_MIN_V22_POLICY_VERSION = 4;

/** Cache TTL for the latest GVL / cmp-list (GVL is published weekly). */
export const GVL_TTL_MS = 24 * 60 * 60 * 1000;

export const URLS = Object.freeze({
  GVL_LATEST: 'https://vendor-list.consensu.org/v3/vendor-list.json',
  GVL_ARCHIVE: (v) => 'https://vendor-list.consensu.org/v3/archives/vendor-list-v' + Number(v) + '.json',
  CMP_LIST: 'https://cmplist.consensu.org/v2/cmp-list.json',            // canonical (spec)
  CMP_LIST_FALLBACK: 'https://cmp-list.consensu.org/v2/cmp-list.json',  // what the IAB validator fetches
  ATP_LIST: 'https://storage.googleapis.com/tcfac/additional-consent-providers.csv',
  COMPLAINT_FORM: 'https://iabeurope.eu/tcf-non-compliance-submission-form/',
  TCF_POLICY: 'https://iabeurope.eu/transparency-consent-framework/',
  TCF_SPEC: 'https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/tree/master/TCFv2',
  GCM_GUIDE: 'https://developers.google.com/tag-platform/security/guides/consent',
  GCM_SETUP: 'https://support.google.com/tagmanager/answer/13695607',
  GPP_SPEC: 'https://github.com/InteractiveAdvertisingBureau/Global-Privacy-Platform',
  UET_CONSENT: 'https://help.ads.microsoft.com/#apex/ads/en/60119/1',
  COOKIELET: 'https://cookielet.com'
});

/** chrome.storage key helpers. */
export const STORAGE_KEYS = Object.freeze({
  tab: (tabId) => 'tab_' + tabId,
  GVL_LATEST: 'gvl_latest',
  CMP_LIST: 'cmp_list',
  gvlVersion: (v) => 'gvl_v' + Number(v),
  manual: (host) => 'manual_' + String(host || '').toLowerCase()
});

/** Badge presentation per status (see shared/checks/findings.js badgeStatus). */
export const BADGE = Object.freeze({
  error: { text: 'ERR', color: '#d93025' },
  warning: { text: '!', color: '#f9ab00' },
  pass: { text: 'OK', color: '#1e8e3e' },
  none: { text: '', color: '#9e9e9e' }
});

/** URLs the inspector cannot instrument (popup shows a guard message). */
export function isUninspectableUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|edge|about|devtools|view-source|file|moz-extension):/i.test(url) ||
    /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)/i.test(url);
}
