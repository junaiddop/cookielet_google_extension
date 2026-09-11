/**
 * Cookielet Consent Inspector — service worker (MV3, ES module).
 *
 * Rules that keep this worker alive and correct:
 *  - every chrome.* listener is registered synchronously in this module's first evaluation
 *  - no top-level await; hydration is lazy (TabStore.run) and serialized
 *  - message handlers always call sendResponse (also on errors) and return true when async
 */
import { MSG, PAGE_CMDS, BADGE, STORAGE_KEYS } from '../shared/constants.js';
import { TabStore } from './state.js';
import { installNetworkObserver } from './network.js';
import { getGvlState } from './gvl_service.js';
import { buildGcmModel } from '../shared/gcm/gcm_model.js';
import { buildTcfModel } from '../shared/tcf/tcf_model.js';
import { buildUetModel } from '../shared/uet/uet_model.js';
import { collectFindings, badgeStatus } from '../shared/checks/findings.js';

/* ---------------- debug logging (opt-in via chrome.storage.local.debug) ---------------- */
let DEBUG = false;
chrome.storage.local.get('debug').then((r) => { DEBUG = r && r.debug === true; }).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.debug) DEBUG = changes.debug.newValue === true; });
function log(...args) { if (DEBUG) console.log('[Cookielet SW]', ...args); }

/* ---------------- state ---------------- */
const store = new TabStore({ log });
const badgeTimers = new Map();
let cachedLists = null; // {gvl, cmpList, at}

store.onChange((tabId) => scheduleBadge(tabId));

installNetworkObserver(store, { log, onNavigation: (tabId) => setBadge(tabId, 'none') });

/* ---------------- badge ---------------- */
function setBadge(tabId, status) {
  const b = BADGE[status] || BADGE.none;
  chrome.action.setBadgeText({ tabId, text: b.text }).catch(() => {});
  if (b.text) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: b.color }).catch(() => {});
    if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ tabId, color: status === 'warning' ? '#202124' : '#ffffff' }).catch(() => {});
  }
}

function computeBadge(tabId) {
  const t = store.get(tabId);
  if (!t) { setBadge(tabId, 'none'); return; }
  try {
    const lists = cachedLists || {};
    const models = { gcm: buildGcmModel(t), tcf: buildTcfModel(t, { gvl: lists.gvl, cmpList: lists.cmpList }), uet: buildUetModel(t), gpp: null };
    const findings = collectFindings(t, models, { gvl: lists.gvl, cmpList: lists.cmpList });
    setBadge(tabId, badgeStatus(findings, models));
  } catch (e) {
    log('badge error', String(e));
  }
}

function scheduleBadge(tabId) {
  if (badgeTimers.has(tabId)) return;
  badgeTimers.set(tabId, setTimeout(() => { badgeTimers.delete(tabId); computeBadge(tabId); }, 300));
}

/* ---------------- injection helpers ---------------- */
async function ensureInjected(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['src/content/content_script.js'], world: 'ISOLATED', injectImmediately: true });
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['src/content/page_injector.js'], world: 'MAIN', injectImmediately: true });
    await store.run(() => { const t = store.ensure(tabId); t.injectedManually = true; store.touch(tabId); });
    log('injected into tab', tabId);
    return { ok: true };
  } catch (e) {
    log('injection failed', tabId, String(e));
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function sendPageCmd(tabId, cmd) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { action: MSG.PAGE_CMD, cmd }, { frameId: 0 });
    return r || { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function reprobe(tabId) {
  let r = await sendPageCmd(tabId, PAGE_CMDS.REPROBE);
  if (!r.ok) {
    const inj = await ensureInjected(tabId); // no relay in the tab → inject (the injector snapshots on HELLO)
    if (!inj.ok) return inj;
    r = await sendPageCmd(tabId, PAGE_CMDS.REPROBE);
    if (!r.ok) return { ok: true, note: 'injected; snapshot sent on handshake' };
  }
  return r;
}

/* ---------------- manual policy answers ---------------- */
async function getManual(host) {
  try { const k = STORAGE_KEYS.manual(host); const r = await chrome.storage.local.get(k); return { responses: r[k] || {} }; } catch (e) { return { responses: {}, error: String(e) }; }
}
async function setManual(host, checkId, value) {
  try {
    const k = STORAGE_KEYS.manual(host);
    const r = await chrome.storage.local.get(k);
    const cur = r[k] || {};
    if (value === null || value === undefined) delete cur[checkId]; else cur[checkId] = !!value;
    await chrome.storage.local.set({ [k]: cur });
    return { ok: true, responses: cur };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/* ---------------- messages ---------------- */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return undefined;
  const action = message.action;

  if (action === MSG.RECORD) {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId == null || tabId < 0 || sender.frameId) { sendResponse({ ok: false }); return undefined; }
    const payload = message.payload || {};
    log('record', payload.type, 'tab', tabId);
    store.run(() => { store.apply(tabId, payload, sender); }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (action === MSG.GET_TAB_DATA) {
    const tabId = message.tabId;
    if (tabId == null) { sendResponse(null); return undefined; }
    store.run(() => store.get(tabId)).then((t) => sendResponse(t || null), () => sendResponse(null));
    return true;
  }
  if (action === MSG.ENSURE_INJECTED) {
    if (message.tabId == null) { sendResponse({ ok: false, error: 'no tabId' }); return undefined; }
    ensureInjected(message.tabId).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (action === MSG.REPROBE) {
    if (message.tabId == null) { sendResponse({ ok: false, error: 'no tabId' }); return undefined; }
    reprobe(message.tabId).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (action === MSG.CLEAR_TAB) {
    if (message.tabId == null) { sendResponse({ ok: false }); return undefined; }
    store.run(() => { store.drop(message.tabId); setBadge(message.tabId, 'none'); }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (action === MSG.GET_GVL) {
    getGvlState({ version: message.version, force: !!message.force }).then((s) => {
      cachedLists = { gvl: s.gvl, cmpList: s.cmpList, at: Date.now() };
      sendResponse(s);
    }, (e) => sendResponse({ gvl: null, cmpList: null, atp: null, versioned: null, errors: { gvl: String(e) } }));
    return true;
  }
  if (action === MSG.GET_MANUAL) { getManual(message.host).then(sendResponse); return true; }
  if (action === MSG.SET_MANUAL) { setManual(message.host, message.checkId, message.value).then(sendResponse); return true; }
  if (action === MSG.SET_DEBUG) {
    chrome.storage.local.set({ debug: !!message.value }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  return undefined; // unknown action: close the channel
});

/* ---------------- lifecycle ---------------- */
chrome.tabs.onRemoved.addListener((tabId) => { store.run(() => { store.drop(tabId); }); });
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  store.run(() => {
    const rec = store.get(removedTabId);
    store.drop(removedTabId);
    if (rec) { store.state[addedTabId] = rec; store.touch(addedTabId); }
  });
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Chrome clears per-tab badge state on navigation; re-apply from the record once the page loads.
  if (changeInfo.status === 'complete') scheduleBadge(tabId);
});
chrome.runtime.onInstalled.addListener(() => { store.run(() => store.dropAll()); chrome.action.setBadgeText({ text: '' }).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { store.run(() => store.dropAll()); });

log('service worker started');
