import { h, clear, statusCard, banner, findingsList, table, stateSpan, pill, eventRow, flagRow, empty, fmtTime } from '../components.js';
import { GCM_SIGNALS } from '../../shared/constants.js';
import { gcmStatus } from '../../shared/gcm/gcm_checks.js';
import { parseGcd, parseGcs, parseGcdWithLabels, SIGNAL_ORDER } from '../../shared/gcm/gcd_parser.js';

const OPTIONAL = ['functionality_storage', 'personalization_storage', 'security_storage'];

function sigColor(s) {
  if (!s || !s.known) return 'notset';
  if (s.effective === 'granted' && s.update === 'granted' && s.default === 'denied') return 'amber';
  if (s.effective === 'denied' && s.update === 'denied' && s.default === 'granted') return 'amber';
  return s.effective === 'granted' ? 'granted' : s.effective === 'denied' ? 'denied' : 'notset';
}

export function render(ctx, root) {
  clear(root);
  const { tab, models, findings } = ctx;
  const gcm = models.gcm;
  const diag = tab.diagnostics || {};
  const own = findings.filter((f) => f.tab === 'gcm');
  const st = gcmStatus(gcm, findings);
  root.appendChild(banner(st.status, st.message));

  /* status strip */
  const strip = h('div', { class: 'status-grid' });
  const ics = gcm.icsFlags || {};
  const cmpName = diag.cmp ? diag.cmp.name : (models.tcf.present ? models.tcf.cmpName : null);
  if (cmpName || ics.usedUpdate || gcm.updateCount) strip.appendChild(statusCard('CMP Installed', cmpName || 'Active', 'ok'));
  if (gcm.googleTagsSeen) strip.appendChild(statusCard('Google Consent Mode', (gcm.gcmActive || ics.usedDefault || gcm.defaultCount) ? 'Correct' : 'Warning', (gcm.gcmActive || ics.usedDefault || gcm.defaultCount) ? 'ok' : 'warn'));
  const hasDefault = gcm.defaultCount > 0 || ics.usedDefault;
  strip.appendChild(statusCard('Consent Mode Default', hasDefault ? 'Active' : (gcm.googleTagsSeen ? 'Not found' : '-'), hasDefault ? 'ok' : (gcm.googleTagsSeen ? 'err' : '')));
  const wrong = own.some((f) => f.id === 'gcm.default_after_tag_load' || f.id === 'gcm.hit_before_default');
  strip.appendChild(statusCard('Tags Loading Order', wrong ? 'Wrong' : (hasDefault && gcm.googleTagsSeen ? 'Correct' : '-'), wrong ? 'err' : (hasDefault && gcm.googleTagsSeen ? 'ok' : '')));
  root.appendChild(strip);
  root.appendChild(findingsList(own));

  /* Consent Mode Signals */
  root.appendChild(h('h2', { text: 'Consent Mode Signals' }));
  const rows = [];
  for (const s of GCM_SIGNALS) {
    const g = gcm.icsSignals[s];
    if (OPTIONAL.includes(s) && gcm.defaults[s] == null && gcm.updates[s] == null && !(g && g.effective != null)) continue;
    const googleCell = g && g.effective != null ? stateSpan(g.effective, '(' + g.source + (g.quiet ? ', waiting' : '') + ')') : h('span', { class: 'state notset', text: gcm.ics ? 'not set (behaves granted)' : '—' });
    rows.push([s, stateSpan(gcm.defaults[s]), stateSpan(gcm.updates[s]), googleCell]);
  }
  if (rows.length) root.appendChild(table(['Parameter', 'Default State', 'Updated State', 'Google state (google_tag_data)'], rows));
  else root.appendChild(empty('No consent signals captured.'));
  if (Object.keys(gcm.defaultScope).some((s) => gcm.defaultScope[s] !== 'global')) {
    root.appendChild(h('p', { class: 'muted small', text: 'Region-scoped defaults: ' + Object.keys(gcm.regionDefaults).map((r) => r + ' → ' + Object.entries(gcm.regionDefaults[r]).map(([k, v]) => k + '=' + v).join(', ')).join(' · ') }));
  }
  if (gcm.ics) {
    root.appendChild(h('h3', { text: 'google_tag_data.ics flags' + (gcm.icsAt ? ' · ' + fmtTime(gcm.icsAt) : '') }));
    root.appendChild(flagRow([['active', ics.active], ['usedDefault', ics.usedDefault], ['usedUpdate', ics.usedUpdate], ['usedDeclare', ics.usedDeclare], ['wasSetLate', ics.wasSetLate, true], ['waitPeriodTimedOut', ics.waitPeriodTimedOut, true], ['accessedAny', ics.accessedAny]]));
  } else if (gcm.googleTagsSeen) root.appendChild(h('p', { class: 'muted small', text: 'google_tag_data.ics not observed (gtag.js not loaded in this document yet).' }));
  if (Object.keys(gcm.setFlags).length) root.appendChild(h('p', { class: 'small', text: 'gtag set flags: ' + Object.entries(gcm.setFlags).map(([k, v]) => k + '=' + v).join(', ') }));
  if (gcm.tcfBridge && gcm.tcfBridge.active) root.appendChild(h('p', { class: 'small', text: 'gtag TCF bridge active (google_tag_manager.tcf): cmpId ' + gcm.tcfBridge.cmpId + ', gdprApplies ' + gcm.tcfBridge.gdprApplies }));

  /* Consent Events (dataLayer) — kept verbatim */
  root.appendChild(h('h2', { text: 'Consent Events (dataLayer)' }));
  const log = h('div', { class: 'event-log' });
  const dlEvents = [...gcm.events.map((e) => ({ ...e, kind: 'consent' })), ...gcm.dlEvents.filter((e) => e.data && (e.data.kind === 'url_change' || e.data.kind === 'gtm.js' || e.data.kind === 'config')).map((e) => ({ ...e, kind: 'dl' }))]
    .sort((a, b) => (a.timestamp - b.timestamp) || 0);
  if (!gcm.events.length) { log.classList.add('muted'); log.textContent = 'No consent default/update calls captured.'; }
  else {
    for (const ev of dlEvents.slice(-60)) {
      const d = ev.data || {};
      if (ev.kind === 'dl') {
        if (d.kind === 'url_change') log.appendChild(h('div', { class: 'event-row divider', text: '↪ navigation ' + d.url }));
        else log.appendChild(eventRow(ev.timestamp, pill('lib', d.kind === 'config' ? 'config ' + d.tagId : d.kind), h('span', { class: 'muted', text: d.dlIndex != null ? 'dataLayer[' + d.dlIndex + ']' : '' })));
        continue;
      }
      log.appendChild(eventRow(ev.timestamp, pill(d.command || 'default', d.command), d.replayed ? pill('replayed', 'replayed') : null,
        h('span', { text: JSON.stringify(d.params || {}) }), h('span', { class: 'muted', text: d.dlIndex != null ? '  dataLayer[' + d.dlIndex + ']' : '' })));
    }
  }
  root.appendChild(log);

  /* Network Signals (gcs / gcd) — kept verbatim */
  root.appendChild(h('h2', { text: 'Network Signals (gcs / gcd)' }));
  const signals = (tab.network && tab.network.signals || []).filter((r) => r.type !== 'bing_hit' && r.type !== 'bing_tag');
  if (!signals.length) root.appendChild(h('div', { class: 'muted', text: 'No Google tag requests captured yet.' }));
  else {
    const rows2 = [];
    for (const rec of signals.slice(-40)) {
      const gcsCell = h('span');
      const gcs = parseGcs(rec.gcs);
      if (gcs && gcs.valid) gcsCell.appendChild(h('span', { class: 'gcd-cell' }, h('span', { class: 'gcd-sig ' + (gcs.ad_storage || 'notset'), title: 'ad_storage: ' + (gcs.ad_storage || 'not set'), text: 'A' }), h('span', { class: 'gcd-sig ' + (gcs.analytics_storage || 'notset'), title: 'analytics_storage: ' + (gcs.analytics_storage || 'not set'), text: 'G' }), h('span', { class: 'muted small', text: ' ' + rec.gcs })));
      else gcsCell.appendChild(h('span', { class: 'muted', text: rec.gcs || '-' }));
      const gcdCell = h('span');
      const gcd = parseGcd(rec.gcd);
      if (gcd) {
        const wrap = h('span', { class: 'gcd-cell' });
        for (const name of SIGNAL_ORDER) { const s = gcd.signals[name]; wrap.appendChild(h('span', { class: 'gcd-sig ' + sigColor(s), title: name + ': ' + (s.label || '-'), text: s.letter || '·' })); }
        gcdCell.appendChild(wrap);
      } else gcdCell.appendChild(h('span', { class: 'muted', text: '-' }));
      const extras = ['npa', 'dma', 'dma_cps', 'gcu', 'gcut', 'gdpr', 'tcfd'].filter((k) => rec[k] != null).map((k) => k + '=' + rec[k]);
      if (rec.gdpr_consent) extras.push('gdpr_consent=' + rec.gdpr_consent.slice(0, 12) + '…');
      const label = rec.type === 'tag_load' ? 'lib' : rec.type === 'hit' ? (rec.subtype || 'hit') : rec.type;
      rows2.push([fmtTime(rec.timestamp), h('span', { title: rec.host + rec.path + (rec.resourceType ? ' [' + rec.resourceType + ']' : '') }, pill(rec.type === 'tag_load' ? 'lib' : 'hit', label), (rec.firstParty ? '⚑ ' : '') + (rec.host + rec.path).slice(0, 44) + ((rec.host + rec.path).length > 44 ? '…' : '')), gcsCell, gcdCell, h('span', { class: 'muted small', text: extras.join(' ') })]);
    }
    root.appendChild(table(['Time', 'Request', 'gcs', 'gcd (as·an·aud·ap)', 'other'], rows2));
    if (signals.some((r) => r.firstParty)) root.appendChild(h('p', { class: 'muted small', text: '⚑ first-party host (server-side tagging endpoint).' }));
  }

  /* Signal Breakdown (latest gcd) */
  if (gcm.latestGcd) {
    root.appendChild(h('h2', { text: 'Signal Breakdown' }));
    const rowsB = [['GCD Code', h('span', { class: 'mono', text: gcm.latestGcd.raw })]];
    if (gcm.latestGcs) rowsB.push(['GCS Code', h('span', { class: 'mono', text: gcm.latestGcs.raw + (gcm.latestGcs.configured ? '' : ' (Consent Mode not configured)') })]);
    for (const r of parseGcdWithLabels(gcm.latestGcd.raw)) rowsB.push([r.signal, h('span', { class: 'state ' + sigColor(r), text: r.label + (r.effective == null ? ' (behaves granted)' : '') })]);
    rowsB.push(['flags', h('span', { class: 'muted', text: 'consent mode active: ' + gcm.latestGcd.active + ' · GPC honoured: ' + gcm.latestGcd.gpc + (gcm.latestGcd.containerDefaults && gcm.latestGcd.containerDefaults.used ? ' · container-scoped defaults used' : '') })]);
    if (gcm.latestTcfd && gcm.latestTcfd.valid) rowsB.push(['tcfd', h('span', { class: 'muted', text: 'CMP id ' + gcm.latestTcfd.cmpId + ' · policy v' + gcm.latestTcfd.tcfPolicyVersion + ' · ' + Object.entries(gcm.latestTcfd.flags).filter(([, v]) => v).map(([k]) => k).join(', ') })]);
    root.appendChild(table(['Signal', 'Status'], rowsB));
  }

  /* detected tags */
  if (gcm.tagIds.length || diag.gtmContainers) {
    root.appendChild(h('h2', { text: 'Detected Google tags' }));
    const list = h('div', { class: 'tag-list' });
    for (const t of gcm.tagIds) list.appendChild(h('span', { class: 'tag', title: t.source, text: t.id }));
    root.appendChild(list);
    root.appendChild(flagRow([['gtag.js', gcm.gtagLoaded], ['GTM', gcm.gtmLoaded], ['Google Ads', gcm.adsActive], ['google_tag_data', gcm.gtagData], ['dataLayer defined by page', gcm.dataLayerDefined], ['GPC', !!diag.gpc]]));
  }
}
