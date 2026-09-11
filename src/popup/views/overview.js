import { h, clear, statusCard, banner, findingsList } from '../components.js';
import { GCM_V2_REQUIRED } from '../../shared/constants.js';
import { gcmStatus } from '../../shared/gcm/gcm_checks.js';

export function render(ctx, root) {
  clear(root);
  const { tab, models, findings } = ctx;
  const gcm = models.gcm, tcf = models.tcf, uet = models.uet;
  const diag = tab.diagnostics || {};
  const st = gcmStatus(gcm, findings);
  root.appendChild(banner(st.status, st.message));

  const grid = h('div', { class: 'status-grid' });
  const hasGcm = gcm.defaultCount || gcm.updateCount || (gcm.icsFlags && (gcm.icsFlags.usedDefault || gcm.icsFlags.usedUpdate));
  const gcmErr = findings.some((f) => f.tab === 'gcm' && f.sev === 'err'), gcmWarn = findings.some((f) => f.tab === 'gcm' && f.sev === 'warn');
  if (hasGcm) grid.appendChild(statusCard('Google Consent Mode', gcmErr ? 'Issues' : gcmWarn ? 'Warning' : 'Active', gcmErr ? 'err' : gcmWarn ? 'warn' : 'ok'));
  else grid.appendChild(statusCard('Google Consent Mode', gcm.googleTagsSeen ? 'Not found' : '-', gcm.googleTagsSeen ? 'err' : ''));

  const hasDefault = gcm.defaultCount > 0 || (gcm.icsFlags && gcm.icsFlags.usedDefault);
  const late = findings.some((f) => f.id === 'gcm.default_after_tag_load' || f.id === 'gcm.ics_no_default');
  grid.appendChild(hasDefault ? statusCard('Consent Mode Default', late ? 'Set too late' : 'Found', late ? 'err' : 'ok', gcm.defaultCount ? 'dataLayer' : 'google_tag_data (GTM template)')
    : statusCard('Consent Mode Default', gcm.googleTagsSeen ? 'Not found' : '-', gcm.googleTagsSeen ? 'err' : ''));

  if (gcm.defaultCount) {
    const missing = GCM_V2_REQUIRED.filter((s) => gcm.defaults[s] == null);
    grid.appendChild(statusCard('Consent Mode v2 Signals', missing.length ? missing.length + ' missing' : 'Complete', missing.length ? 'warn' : 'ok'));
  } else grid.appendChild(statusCard('Consent Mode v2 Signals', '-', ''));

  if (gcm.googleTagsSeen && hasDefault) {
    const bad = findings.some((f) => f.id === 'gcm.default_after_tag_load' || f.id === 'gcm.hit_before_default');
    const heur = findings.some((f) => f.id === 'gcm.default_after_tag_load_net');
    grid.appendChild(statusCard('Tags Loading Order', bad ? 'Wrong' : heur ? 'Check' : 'Correct', bad ? 'err' : heur ? 'warn' : 'ok'));
  } else grid.appendChild(statusCard('Tags Loading Order', '-', ''));

  grid.appendChild(diag.cmp ? statusCard('CMP Detected', diag.cmp.name, 'ok') : statusCard('CMP Detected', tcf.present ? (tcf.cmpName || 'IAB CMP') : '-', tcf.present ? 'ok' : ''));

  if (tcf.present) grid.appendChild(statusCard('IAB TCF API', tcf.phase === 'loaded' ? 'CMP loaded' : tcf.phase === 'error' ? 'Error' : tcf.phase === 'locator' ? 'Locator only' : 'Found, ' + (tcf.cmpStatus || 'not loaded'), tcf.phase === 'loaded' ? 'ok' : tcf.phase === 'error' ? 'err' : 'warn', tcf.cmpName ? tcf.cmpName + (tcf.cmpId ? ' · id ' + tcf.cmpId : '') : null));
  else grid.appendChild(statusCard('IAB TCF API', 'Not found', ''));

  if (tcf.tcString) {
    const tcBad = findings.some((f) => f.tab === 'tcf' && f.area === 'TC string' && f.sev === 'err');
    grid.appendChild(statusCard('TC String', tcBad ? 'Invalid' : 'Valid', tcBad ? 'err' : 'ok', tcf.decoded && !tcf.decoded.error ? tcf.decoded.byteSize + ' bytes · GVL v' + tcf.decoded.vendorListVersion : null));
  } else if (tcf.present && tcf.eventStatus === 'cmpuishown') grid.appendChild(statusCard('TC String', 'Awaiting user action', 'warn'));
  else if (tcf.present && tcf.gdprApplies === false) grid.appendChild(statusCard('TC String', 'GDPR does not apply', ''));
  else grid.appendChild(statusCard('TC String', '-', ''));

  const gpp = tab.gpp || {};
  grid.appendChild(statusCard('IAB GPP API', gpp.apiFound || gpp.ping ? (gpp.ping && gpp.ping.data && gpp.ping.data.signalStatus === 'ready' ? 'Ready' : 'Found') : 'Not found', gpp.apiFound || gpp.ping ? 'ok' : ''));

  const ac = tcf.ac;
  grid.appendChild(statusCard('Google Additional Consent', ac ? (ac.valid ? 'v' + ac.version + ' · ' + ac.consented.length + ' consented' : 'Invalid') : '-', ac ? (ac.valid ? 'ok' : 'warn') : ''));
  grid.appendChild(statusCard('Microsoft UET', uet.tagSeen || uet.apiFound ? (uet.adStorage ? 'ad_storage ' + uet.adStorage : 'No consent signal') : '-', uet.tagSeen || uet.apiFound ? (uet.adStorage ? 'ok' : 'warn') : ''));
  root.appendChild(grid);

  root.appendChild(h('h2', { text: 'Findings' + (findings.length ? ' (' + findings.length + ')' : '') }));
  if (!findings.length) root.appendChild(h('p', { class: 'muted', text: tab.instrumented ? 'No issues found.' : 'Waiting for the page…' }));
  root.appendChild(findingsList(findings));
}
