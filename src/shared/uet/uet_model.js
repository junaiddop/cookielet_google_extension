/**
 * Microsoft UET (Bing Ads) consent model (pure, ESM).
 *
 * Sources: `uetq.push('consent','default'|'update',{ad_storage})` pushes captured by the
 * injector, the UET instance config (`uetq.uetConfig.consent`) once bat.js replaced the
 * queue array, and bat.bing.com / bat.bing.net beacons (`asc=G|D`, `evt=consent&src=…`).
 */

export function buildUetModel(tab) {
  const u = (tab && tab.uet) || {};
  const net = (tab && tab.network && tab.network.signals) || [];
  const events = u.events || [];
  const m = {
    apiFound: !!u.apiFound, kind: u.kind || null, config: u.config || null,
    events, adStorage: null, adStorageSource: null, enforced: false, tagRequests: [], tagLoads: [], latestAsc: null, consentPings: [], tagSeen: false
  };
  for (const ev of events) {
    const d = ev.data || {};
    if (d.params && d.params.ad_storage) { m.adStorage = d.params.ad_storage; m.adStorageSource = 'uetq.push ' + (d.command || ''); }
  }
  if (m.config && m.config.consent) {
    const c = m.config.consent;
    if (c.enabled === true || c.adStorageUpdated === true || typeof c.adStorageAllowed === 'boolean') {
      if (typeof c.adStorageAllowed === 'boolean') { m.adStorage = c.adStorageAllowed ? 'granted' : 'denied'; m.adStorageSource = 'uetConfig.consent'; }
      m.enforced = c.enforced === true;
    }
  }
  for (const rec of net) {
    if (rec.type === 'bing_tag') m.tagLoads.push(rec);
    if (rec.type === 'bing_hit') {
      m.tagRequests.push(rec);
      if (rec.asc) m.latestAsc = rec.asc;
      if (rec.evt === 'consent') m.consentPings.push(rec);
    }
  }
  m.tagSeen = m.tagRequests.length > 0 || m.tagLoads.length > 0;
  if (!m.adStorage && m.latestAsc) { m.adStorage = m.latestAsc === 'G' ? 'granted' : m.latestAsc === 'D' ? 'denied' : null; m.adStorageSource = 'asc parameter'; }
  return m;
}

export function runUetChecks(tab, uet) {
  const out = [];
  if (!uet) return out;
  if (uet.tagSeen && !uet.adStorage && !uet.apiFound) {
    out.push({ id: 'uet.no_consent', sev: 'warn', area: 'Microsoft UET', tab: 'uet', title: 'UET without consent signal',
      msg: 'No consent signal reported yet. This site may not have Microsoft Consent Mode configured (bat.bing.com beacons carry no asc parameter).' });
  }
  if (uet.enforced) {
    out.push({ id: 'uet.enforced', sev: 'info', area: 'Microsoft UET', tab: 'uet', title: 'UET auto-enforced consent',
      msg: 'UET auto-enforced ad storage consent (no page push) — bat.js detected a CMP or an EEA time zone.' });
  }
  const tcf = tab && tab.tcf && tab.tcf.data && tab.tcf.data.data;
  if (uet.adStorage === 'granted' && tcf && tcf.gdprApplies === true && tcf.purpose && tcf.purpose.consents && tcf.purpose.consents[1] === false && !(tcf.purpose.legitimateInterests && tcf.purpose.legitimateInterests[1])) {
    out.push({ id: 'uet.granted_without_purpose1', sev: 'warn', area: 'Microsoft UET', tab: 'uet', title: 'UET granted without TCF purpose 1',
      msg: 'Microsoft UET reports ad_storage granted while the TC string has no consent for purpose 1 (store and/or access information on a device).' });
  }
  return out;
}

export default { buildUetModel, runUetChecks };
