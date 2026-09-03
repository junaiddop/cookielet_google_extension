/**
 * Google Consent Mode model — turns a tab record into what the checks and
 * views need (pure, ESM). Two sources are reconciled:
 *   - what the PAGE did: dataLayer `consent default/update` pushes (`tab.gcm.events`)
 *   - what GOOGLE saw: `google_tag_data.ics` (`tab.gcm.ics`), which is authoritative
 *     (GTM consent templates write straight into ics without touching dataLayer)
 */
import { GCM_SIGNALS } from '../constants.js';
import { parseGcd, parseGcs, parseTcfd } from './gcd_parser.js';

function bool2state(v) { return v === true ? 'granted' : v === false ? 'denied' : null; }

function normRegion(r) {
  if (r == null) return null;
  if (Array.isArray(r)) return r.map(String).map((s) => s.toUpperCase());
  return [String(r).toUpperCase()];
}

/** gtag precedence: update > default > declare > implicit. */
export function icsEffective(entry) {
  if (!entry) return { state: null, source: null };
  if (entry.update != null) return { state: bool2state(entry.update), source: 'update' };
  if (entry.default != null) return { state: bool2state(entry.default), source: 'default' };
  if (entry.declare != null) return { state: bool2state(entry.declare), source: 'declare' };
  if (entry.implicit != null) return { state: bool2state(entry.implicit), source: 'implicit' };
  return { state: null, source: null };
}

export function buildGcmModel(tab) {
  const t = tab || {};
  const gcm = t.gcm || {};
  const events = gcm.events || [];
  const dlEvents = gcm.dl || [];
  const diag = t.diagnostics || {};
  const net = t.network || {};

  const m = {
    events, dlEvents,
    defaultSets: [], defaults: {}, defaultScope: {}, regionDefaults: {}, updates: {}, setFlags: {},
    defaultCount: 0, updateCount: 0,
    firstDefaultAt: null, firstDefaultReplayed: false, firstUpdateAt: null, firstUpdateReplayed: false,
    waitForUpdate: null, regions: [],
    ics: gcm.ics ? gcm.ics.data : null, icsAt: gcm.ics ? gcm.ics.timestamp : null,
    icsFlags: {}, icsSignals: {},
    dl: { consentDefaultIndex: null, consentUpdateIndex: null, gtmJsIndex: null, gtmLoadIndex: null, gtmDomIndex: null, firstConfigIndex: null, firstJsIndex: null },
    tagIds: Array.isArray(diag.tagIds) ? diag.tagIds : [],
    adsActive: !!diag.adsActive, gtagLoaded: !!diag.gtagLoaded, gtmLoaded: !!diag.gtmLoaded, gtagData: !!diag.gtagData,
    gcmActive: !!diag.gcmActive, tcfBridge: diag.gtmTcf || null, gtagTcfSupport: !!diag.gtagTcfSupport,
    dataLayerDefined: !!diag.dataLayer, dataLayerNonArray: !!diag.dataLayerNonArray,
    network: { firstTagLoadAt: net.firstTagLoadAt || null, firstCollectAt: net.firstCollectAt || null, signals: net.signals || [] },
    latestGcd: null, latestGcs: null, latestTcfd: null, gdprConsentValues: [],
    googleTagsSeen: false, googleTrafficSeen: false, consentParamsSeen: false
  };

  const seen = new Set();
  for (const ev of events) {
    const d = ev.data || {};
    const params = d.params || {};
    if (typeof d.dlIndex === 'number') {
      const key = d.command + '|' + d.dlIndex + '|' + JSON.stringify(params);
      if (seen.has(key)) continue; // replayed duplicate of a captured push
      seen.add(key);
    }
    if (d.command === 'default') {
      m.defaultCount++;
      const region = normRegion(params.region);
      m.defaultSets.push({ params, region, dlIndex: d.dlIndex, replayed: !!d.replayed, timestamp: ev.timestamp });
      if (m.firstDefaultAt == null) { m.firstDefaultAt = ev.timestamp; m.firstDefaultReplayed = !!d.replayed; }
      if (params.wait_for_update != null) m.waitForUpdate = Number(params.wait_for_update);
      if (region) m.regions.push(...region);
      for (const s of GCM_SIGNALS) {
        if (params[s] == null) continue;
        if (region) region.forEach((r) => { (m.regionDefaults[r] = m.regionDefaults[r] || {})[s] = params[s]; });
        else { m.defaults[s] = params[s]; m.defaultScope[s] = 'global'; }
      }
      if (m.dl.consentDefaultIndex == null && typeof d.dlIndex === 'number') m.dl.consentDefaultIndex = d.dlIndex;
    } else if (d.command === 'update') {
      m.updateCount++;
      if (m.firstUpdateAt == null) { m.firstUpdateAt = ev.timestamp; m.firstUpdateReplayed = !!d.replayed; }
      for (const s of GCM_SIGNALS) if (params[s] != null) m.updates[s] = params[s];
      if (m.dl.consentUpdateIndex == null && typeof d.dlIndex === 'number') m.dl.consentUpdateIndex = d.dlIndex;
    } else if (d.command === 'set') {
      Object.keys(params).forEach((k) => { m.setFlags[k] = params[k]; });
    }
  }
  // region-only defaults (no global set): when every region agrees, use that value (most CMPs scope
  // their default to the EEA); when regions disagree we cannot know the visitor's region → 'mixed'.
  for (const s of GCM_SIGNALS) {
    if (m.defaults[s] != null) continue;
    const regions = Object.keys(m.regionDefaults).filter((r) => m.regionDefaults[r][s] != null);
    if (!regions.length) continue;
    const values = [...new Set(regions.map((r) => m.regionDefaults[r][s]))];
    if (values.length === 1) { m.defaults[s] = values[0]; m.defaultScope[s] = 'region:' + regions.join(','); }
    else { m.defaults[s] = { regionScoped: true, regions, values }; m.defaultScope[s] = 'mixed'; }
  }

  for (const ev of dlEvents) {
    const d = ev.data || {};
    const idx = typeof d.dlIndex === 'number' ? d.dlIndex : null;
    if (idx == null) continue;
    if (d.kind === 'gtm.js' && m.dl.gtmJsIndex == null) m.dl.gtmJsIndex = idx;
    if (d.kind === 'gtm.load' && m.dl.gtmLoadIndex == null) m.dl.gtmLoadIndex = idx;
    if (d.kind === 'gtm.dom' && m.dl.gtmDomIndex == null) m.dl.gtmDomIndex = idx;
    if (d.kind === 'config' && m.dl.firstConfigIndex == null) m.dl.firstConfigIndex = idx;
    if (d.kind === 'js' && m.dl.firstJsIndex == null) m.dl.firstJsIndex = idx;
  }

  if (m.ics) {
    const f = m.ics;
    m.icsFlags = {
      active: f.active === true, usedDefault: f.usedDefault === true, usedUpdate: f.usedUpdate === true, usedDeclare: f.usedDeclare === true,
      usedImplicit: f.usedImplicit === true, wasSetLate: f.wasSetLate === true, waitPeriodTimedOut: f.waitPeriodTimedOut === true, accessedAny: f.accessedAny === true,
      hasUsedDefaultFlag: typeof f.usedDefault === 'boolean', hasUsedUpdateFlag: typeof f.usedUpdate === 'boolean'
    };
    const entries = f.entries || {};
    for (const s of GCM_SIGNALS) {
      const e = entries[s];
      const eff = icsEffective(e);
      m.icsSignals[s] = e ? {
        default: bool2state(e.default), update: bool2state(e.update), declare: bool2state(e.declare), implicit: bool2state(e.implicit),
        quiet: e.quiet === true, region: e.region || null, effective: eff.state, source: eff.source, behaves: eff.state === 'denied' ? 'denied' : 'granted'
      } : { default: null, update: null, declare: null, implicit: null, quiet: false, region: null, effective: null, source: null, behaves: 'granted' };
    }
  }

  // network
  for (const rec of m.network.signals) {
    if (rec.gcd) m.latestGcd = parseGcd(rec.gcd) || m.latestGcd;
    if (rec.gcs) m.latestGcs = parseGcs(rec.gcs) || m.latestGcs;
    if (rec.tcfd) m.latestTcfd = parseTcfd(rec.tcfd) || m.latestTcfd;
    if (rec.gdpr_consent && !/^(tcunavailable|tcempty)$/i.test(rec.gdpr_consent)) m.gdprConsentValues.push({ value: rec.gdpr_consent, host: rec.host, timestamp: rec.timestamp });
  }

  // gtag/GTM/Google Ads *tag* evidence — GPT / DoubleClick ad requests alone are TCF territory, not Consent Mode
  m.consentParamsSeen = m.network.signals.some((r) => r.gcs || r.gcd);
  m.googleTrafficSeen = m.network.signals.some((r) => r.type === 'tag_load' || r.type === 'hit');
  // window.google_tag_data alone is not evidence: Google Publisher Tag creates it too (without .ics)
  m.googleTagsSeen = !!(m.network.firstTagLoadAt || m.consentParamsSeen || m.tagIds.length || m.defaultCount || m.updateCount || m.ics);
  return m;
}

/** Effective state of a signal as the page/Google see it: ics first, else dataLayer update ?? default. */
export function effectiveState(m, signal) {
  if (m.ics && m.icsSignals[signal] && m.icsSignals[signal].effective != null) return m.icsSignals[signal].effective;
  if (m.updates[signal] != null) return m.updates[signal];
  const d = m.defaults[signal];
  if (d != null && typeof d === 'string') return d;
  return null;
}

export default { buildGcmModel, effectiveState, icsEffective };
