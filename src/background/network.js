/**
 * webRequest observer (ESM). Observational only — never blocks or modifies.
 *
 * Listens on <all_urls> because:
 *  - the top-frame main_frame request is the navigation reset point,
 *  - server-side GTM / first-party proxies carry gcs/gcd on the publisher's own host.
 * Requests are classified by `details.type` first (script → tag load; image/xhr/ping/beacon → hit),
 * then sub-typed by path. Only top-frame (frameId 0), non-prerender requests are recorded.
 */

const GOOGLE_HOST_RE = /(^|\.)(google-analytics\.com|analytics\.google\.com|googletagmanager\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com|googletagservices\.com|merchant-center-analytics\.goog|google\.[a-z]{2,3}(\.[a-z]{2})?|adservice\.google\.[a-z.]+)$/i;
const BING_HOST_RE = /(^|\.)(bat\.bing\.com|bat\.bing\.net|commerce\.bing\.com|mtag\.microsoft\.com)$/i;

const PARAMS = ['gcs', 'gcd', 'npa', 'dma', 'dma_cps', 'gdpr', 'gdpr_consent', 'tcfd', 'gcu', 'gcut', 'pscdl', 'asc', 'evt', 'gasc', 'tcf', 'gpp', 'gpp_sid', 'us_privacy'];
const HIT_TYPES = new Set(['image', 'xmlhttprequest', 'ping', 'beacon', 'other', 'media']);

export function classifyPath(host, pathname, resourceType, isBing) {
  const p = pathname.toLowerCase();
  if (isBing) {
    if (/\/action(p|-err)?\//.test(p) || /\/cst\//.test(p) || /\/tags\//.test(p)) return { type: 'bing_hit', subtype: 'beacon', lib: null };
    if (/bat\.js$/.test(p) || /\/p\/action\//.test(p) || resourceType === 'script') return { type: 'bing_tag', subtype: 'library', lib: 'uet' };
    return { type: 'bing_hit', subtype: 'other', lib: null };
  }
  if (resourceType === 'script') {
    let lib = 'other';
    if (/\/gtag\/js/.test(p) || /\/gtag\/destination/.test(p) || /\/gtag\.js$/.test(p)) lib = 'gtag';
    else if (/\/gtm\.js$/.test(p) || /\/gtm\.js/.test(p)) lib = 'gtm';
    else if (/gpt\.js$/.test(p) || /\/gpt\//.test(p)) lib = 'gpt';
    else if (/adsbygoogle/.test(p)) lib = 'adsense';
    else if (/\/uet\//.test(p)) lib = 'uet';
    return { type: 'tag_load', subtype: 'library', lib };
  }
  if (HIT_TYPES.has(resourceType)) {
    let subtype = 'other';
    if (/\/g\/collect|\/collect$|\/mc\/collect|\/j\/collect|\/r\/collect/.test(p)) subtype = 'collect';
    else if (/\/pagead\/(viewthrough)?conversion|\/ccm\/|\/pagead\/1p-conversion|\/pagead\/uconversion|\/rmkt\/collect|\/pagead\/form-data|\/activity/.test(p)) subtype = 'conversion';
    else if (/\/ga-audiences|\/pagead\/1p-user-list|\/pagead\/set_partitioned_cookie/.test(p)) subtype = 'audience';
    else if (/\/gampad\/ads|\/pagead\/ads|\/pagead\/adview|\/pagead\/interaction/.test(p)) subtype = 'ad_request';
    else if (/^\/td$|\/td\?/.test(p)) subtype = 'diagnostics';
    else if (/\/ccm\/geo/.test(p)) subtype = 'geo';
    return { type: 'hit', subtype, lib: null };
  }
  return { type: 'other', subtype: resourceType || 'unknown', lib: null };
}

/**
 * @param {import('./state.js').TabStore} store
 * @param {(tabId:number)=>void} onNavigation  called after a top-frame navigation reset
 * @param {(...a)=>void} log
 */
export function installNetworkObserver(store, { onNavigation = () => {}, log = () => {} } = {}) {
  chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (details.tabId == null || details.tabId < 0) return;
    if (details.documentLifecycle === 'prerender') return;
    if (details.frameId !== 0) return; // top frame only

    if (details.type === 'main_frame') {
      store.run(() => {
        store.resetForNavigation(details.tabId, details.url, details.timeStamp);
        onNavigation(details.tabId);
      });
      return;
    }
    if (details.type === 'sub_frame') return;

    let u;
    try { u = new URL(details.url); } catch (e) { return; }
    const host = u.hostname.toLowerCase();
    const isBing = BING_HOST_RE.test(host);
    const isGoogle = GOOGLE_HOST_RE.test(host);
    const params = {};
    for (const k of PARAMS) { const v = u.searchParams.get(k); if (v != null && v !== '') params[k] = v; }
    const hasConsentParams = !!(params.gcs || params.gcd || params.tcfd || params.gdpr_consent || params.asc);
    if (!isBing && !isGoogle && !hasConsentParams) return;

    const cls = classifyPath(host, u.pathname, details.type, isBing);
    if (cls.type === 'other' && !hasConsentParams) return;
    const signal = {
      host,
      path: u.pathname.slice(0, 120),
      type: cls.type, subtype: cls.subtype, lib: cls.lib,
      resourceType: details.type, method: details.method,
      firstParty: !isGoogle && !isBing,
      timestamp: details.timeStamp,
      ...params
    };
    log('request tab', details.tabId, cls.type, cls.subtype, host + u.pathname.slice(0, 60), params.gcs ? 'gcs=' + params.gcs : '', params.gcd ? 'gcd=' + params.gcd : '');
    store.run(() => { store.recordNetwork(details.tabId, signal); });
  }, { urls: ['<all_urls>'] });
}

export default { installNetworkObserver, classifyPath };
