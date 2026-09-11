/**
 * Per-tab state store for the service worker (ESM).
 *
 *  - one record per tab, identified by the top-frame documentId (Chrome 106+)
 *  - every mutation runs through ONE promise chain (arrival order is honoured)
 *  - persisted to chrome.storage.session (debounced, awaited, quota-aware)
 *  - hydrated lazily on first use — never at module top level (MV3 worker rule)
 */
import { CAPS, EVT, STATE_VERSION, STORAGE_KEYS } from '../shared/constants.js';

const PERSIST_DEBOUNCE_MS = 200;
const GDPR_CONSENT_MAX = 1200;

export function blankTab(init = {}) {
  return {
    v: STATE_VERSION,
    rev: 0,
    updatedAt: init.timestamp || Date.now(),
    pageUrl: init.url || null,
    title: init.title || null,
    startedAt: init.timestamp || Date.now(),
    navigationAt: init.navigationAt || null,
    documentId: init.documentId || null,
    instrumented: false,
    injectedManually: false,
    readyStateAtInject: null,
    urlHistory: [],
    diagnostics: null,
    diagnosticsAt: null,
    gcm: { events: [], dl: [], ics: null, icsHistory: [] },
    tcf: { apiFound: false, locatorFound: false, viaPostMessage: false, ping: null, pingHistory: [], data: null, history: [], commands: {}, errors: [], storage: null },
    gpp: { apiFound: false, locatorFound: false, ping: null, events: [], data: null, errors: [], commands: {}, sections: {} },
    uet: { apiFound: false, kind: null, config: null, events: [], tagRequests: [] },
    network: { signals: [], firstTagLoadAt: null, firstCollectAt: null }
  };
}

function pushCapped(arr, item, cap) {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

function compactIcs(data) {
  if (!data) return null;
  const entries = {};
  for (const [k, e] of Object.entries(data.entries || {})) entries[k] = { d: e.default, u: e.update, i: e.implicit, dc: e.declare, q: e.quiet };
  return { active: data.active, usedDefault: data.usedDefault, usedUpdate: data.usedUpdate, wasSetLate: data.wasSetLate, waitPeriodTimedOut: data.waitPeriodTimedOut, entries };
}

export class TabStore {
  constructor({ log = () => {} } = {}) {
    this.state = {};
    this.hydratePromise = null;
    this.chain = Promise.resolve();
    this.dirty = new Set();
    this.persistTimer = null;
    this.persisting = null;
    this.log = log;
    this.listeners = [];
  }

  /** Subscribe to tab changes: fn(tabId, record). */
  onChange(fn) { this.listeners.push(fn); }

  hydrate() {
    if (!this.hydratePromise) {
      this.hydratePromise = (async () => {
        try {
          const all = await chrome.storage.session.get(null);
          for (const k of Object.keys(all)) {
            if (k.startsWith('tab_') && all[k] && all[k].v === STATE_VERSION) this.state[Number(k.slice(4))] = all[k];
          }
          this.log('hydrated', Object.keys(this.state).length, 'tab record(s)');
        } catch (e) {
          this.log('hydrate failed', String(e));
        }
      })();
    }
    return this.hydratePromise;
  }

  /** Run fn on the serialized chain (after hydration). Errors are logged, never propagated. */
  run(fn) {
    const p = this.chain.then(() => this.hydrate()).then(fn);
    this.chain = p.catch((e) => this.log('store handler error', String(e && e.stack || e)));
    return p;
  }

  get(tabId) { return this.state[tabId] || null; }

  ensure(tabId, init) {
    if (!this.state[tabId]) this.state[tabId] = blankTab(init);
    return this.state[tabId];
  }

  touch(tabId) {
    const t = this.state[tabId];
    if (!t) return;
    t.rev++;
    t.updatedAt = Date.now();
    this.dirty.add(tabId);
    this.schedulePersist();
    for (const l of this.listeners) { try { l(tabId, t); } catch (e) { /* listener error */ } }
  }

  drop(tabId) {
    delete this.state[tabId];
    this.dirty.delete(tabId);
    chrome.storage.session.remove(STORAGE_KEYS.tab(tabId)).catch(() => {});
  }

  async dropAll() {
    this.state = {};
    this.dirty.clear();
    try {
      const all = await chrome.storage.session.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith('tab_'));
      if (keys.length) await chrome.storage.session.remove(keys);
    } catch (e) { /* ignore */ }
  }

  schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = null; this.run(() => this.flush()); }, PERSIST_DEBOUNCE_MS);
  }

  /** Persist dirty tabs; on quota errors drop the oldest bulk data and retry once. */
  async flush() {
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const tabId of ids) {
      const t = this.state[tabId];
      if (!t) continue;
      try {
        await chrome.storage.session.set({ [STORAGE_KEYS.tab(tabId)]: t });
      } catch (e) {
        this.log('persist failed for tab', tabId, String(e), '— trimming');
        this.trim(t);
        try { await chrome.storage.session.set({ [STORAGE_KEYS.tab(tabId)]: t }); } catch (e2) { this.log('persist retry failed', String(e2)); }
      }
    }
  }

  trim(t) {
    t.network.signals.splice(0, Math.floor(t.network.signals.length / 2));
    t.gpp.events.splice(0, Math.floor(t.gpp.events.length / 2));
    t.gcm.dl.splice(0, Math.floor(t.gcm.dl.length / 2));
    t.tcf.history.splice(0, Math.floor(t.tcf.history.length / 2));
    t.gcm.icsHistory.length = 0;
  }

  /** Top-frame navigation started: fresh record for the tab. */
  resetForNavigation(tabId, url, timestamp) {
    const prev = this.state[tabId];
    this.state[tabId] = blankTab({ url, timestamp, navigationAt: timestamp });
    this.log('navigation → reset tab', tabId, url, prev ? '(had ' + prev.rev + ' revs)' : '');
    this.touch(tabId);
    return this.state[tabId];
  }

  /**
   * Apply an injector event. `sender` is the chrome.runtime MessageSender.
   * Returns the record (or null when ignored).
   */
  apply(tabId, payload, sender = {}) {
    const { type, data, timestamp } = payload || {};
    if (!type) return null;
    if (sender.documentLifecycle === 'prerender') return null; // never let a prerendered doc touch the visible tab's record
    const docId = sender.documentId || null;

    if (type === EVT.PAGE_INIT) {
      const prev = this.state[tabId];
      let t;
      if (!prev) {
        t = this.ensure(tabId, { url: data && data.url, title: data && data.title, timestamp, documentId: docId });
      } else if (prev.documentId && docId && prev.documentId !== docId) {
        this.log('PAGE_INIT from a new document — resetting tab', tabId);
        t = this.state[tabId] = blankTab({ url: data && data.url, title: data && data.title, timestamp, documentId: docId });
      } else if (!prev.documentId && !docId && data && data.readyState === 'loading' && prev.instrumented && !(data.replayed)) {
        // very old Chrome without documentId: fall back to the readyState heuristic
        t = this.state[tabId] = blankTab({ url: data && data.url, title: data && data.title, timestamp });
      } else {
        t = prev; // same document: merge (late/manual injection, re-snapshot after extension reload)
        if (!t.documentId && docId) t.documentId = docId;
        if (data && data.url) t.pageUrl = data.url;
        if (data && data.title) t.title = data.title;
        if (!t.startedAt) t.startedAt = timestamp;
      }
      t.instrumented = true;
      if (data && data.readyState && !t.readyStateAtInject) t.readyStateAtInject = data.readyState;
      if (data && data.replayed) t.injectedManually = t.injectedManually || !!data.manual;
      this.touch(tabId);
      return t;
    }

    const t = this.state[tabId];
    if (!t) return null; // events before PAGE_INIT are not expected (injector queues until handshake)
    if (t.documentId && docId && t.documentId !== docId) return null; // stale document (bfcache'd / prerender)

    switch (type) {
      case EVT.URL_CHANGE:
        if (data && data.url) { t.pageUrl = data.url; pushCapped(t.urlHistory, { url: data.url, timestamp }, 50); pushCapped(t.gcm.dl, { data: { kind: 'url_change', url: data.url, dlIndex: data.dlIndex }, timestamp }, CAPS.DL_EVENTS); }
        break;
      case EVT.DIAGNOSTICS: t.diagnostics = data; t.diagnosticsAt = timestamp; break;
      case EVT.CONSENT_MODE_EVENT: pushCapped(t.gcm.events, { data, timestamp }, CAPS.CONSENT_EVENTS); break;
      case EVT.DL_EVENT: pushCapped(t.gcm.dl, { data, timestamp }, CAPS.DL_EVENTS); break;
      case EVT.GCM_ICS: t.gcm.ics = { data, timestamp }; pushCapped(t.gcm.icsHistory, { data: compactIcs(data), timestamp }, CAPS.ICS_HISTORY); break;
      case EVT.TCF_API_FOUND: t.tcf.apiFound = !!(data && data.api); t.tcf.locatorFound = !!(data && data.locator); t.tcf.viaPostMessage = !!(data && data.viaPostMessage); break;
      case EVT.TCF_PING: {
        t.tcf.ping = { data, timestamp };
        const last = t.tcf.pingHistory[t.tcf.pingHistory.length - 1];
        const sig = data ? [data.cmpStatus, data.cmpLoaded, data.displayStatus, data.gdprApplies, data.cmpId].join('|') : 'null';
        if (!last || last.sig !== sig) pushCapped(t.tcf.pingHistory, { sig, cmpStatus: data && data.cmpStatus, cmpLoaded: data && data.cmpLoaded, displayStatus: data && data.displayStatus, gdprApplies: data && data.gdprApplies, timestamp }, 20);
        break;
      }
      case EVT.TCF_DATA: {
        t.tcf.data = { data, timestamp };
        const last = t.tcf.history[t.tcf.history.length - 1];
        const entry = { eventStatus: data && data.eventStatus, cmpStatus: data && data.cmpStatus, tcString: data && data.tcString, listenerId: data && data.listenerId, gdprApplies: data && data.gdprApplies, timestamp };
        if (!last || last.eventStatus !== entry.eventStatus || last.tcString !== entry.tcString || last.cmpStatus !== entry.cmpStatus) pushCapped(t.tcf.history, entry, CAPS.TCF_HISTORY);
        break;
      }
      case EVT.TCF_COMMAND: if (data && data.command) t.tcf.commands[data.command] = { ok: !!data.ok, note: data.note == null ? null : data.note, timestamp }; break;
      case EVT.TCF_ERROR: pushCapped(t.tcf.errors, { data, timestamp }, CAPS.TCF_ERRORS); break;
      case EVT.TCF_STORAGE: t.tcf.storage = { data, timestamp }; break;
      case EVT.GPP_API_FOUND: t.gpp.apiFound = !!(data && data.api); t.gpp.locatorFound = !!(data && data.locator); break;
      case EVT.GPP_PING: t.gpp.ping = { data, timestamp }; break;
      case EVT.GPP_EVENT: pushCapped(t.gpp.events, { data, timestamp }, CAPS.GPP_EVENTS); break;
      case EVT.GPP_DATA: t.gpp.data = { data, timestamp }; break;
      case EVT.GPP_ERROR: pushCapped(t.gpp.errors, { data, timestamp }, 20); break;
      case EVT.GPP_COMMAND: if (data && data.command) t.gpp.commands[data.command] = { ok: !!data.ok, note: data.note == null ? null : data.note, timestamp }; break;
      case EVT.GPP_SECTION: if (data && data.prefix) t.gpp.sections[data.prefix] = !!data.present; break;
      case EVT.UET_API_FOUND: t.uet.apiFound = true; if (data) { if (data.kind) t.uet.kind = data.kind; if (data.config) t.uet.config = data.config; } break;
      case EVT.UET_EVENT: pushCapped(t.uet.events, { data, timestamp }, CAPS.UET_EVENTS); break;
      case EVT.UET_STATE: if (data) { if (data.kind) t.uet.kind = data.kind; if (data.config !== undefined) t.uet.config = data.config; } break;
      default: return null;
    }
    this.touch(tabId);
    return t;
  }

  /** Record a network signal for a tab (creates the record if the page was never instrumented). */
  recordNetwork(tabId, signal) {
    const t = this.ensure(tabId, { timestamp: signal.timestamp });
    if (signal.gdpr_consent && signal.gdpr_consent.length > GDPR_CONSENT_MAX) { signal.gdpr_consent = signal.gdpr_consent.slice(0, GDPR_CONSENT_MAX); signal.truncated = true; }
    pushCapped(t.network.signals, signal, CAPS.NETWORK_SIGNALS);
    if (signal.type === 'tag_load' && (signal.lib === 'gtag' || signal.lib === 'gtm') && !t.network.firstTagLoadAt) t.network.firstTagLoadAt = signal.timestamp;
    if (signal.type === 'hit' && ['collect', 'conversion', 'audience'].includes(signal.subtype) && !t.network.firstCollectAt) t.network.firstCollectAt = signal.timestamp;
    this.touch(tabId);
    return t;
  }
}

export default { TabStore, blankTab };
