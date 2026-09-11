import { h, clear, findingsList, table, pill, eventRow, section, checkItem, flagRow, fmtTime } from '../components.js';

export function render(ctx, root) {
  clear(root);
  const { models, findings } = ctx;
  const uet = models.uet;
  root.appendChild(findingsList(findings.filter((f) => f.tab === 'uet')));

  const bar = h('div', { class: 'pillbar' });
  if (uet.tagSeen) bar.appendChild(h('div', { class: 'p ok', text: 'Microsoft UET tag detected (' + uet.tagRequests.length + ' beacon(s))' }));
  else if (uet.apiFound) bar.appendChild(h('div', { class: 'p ok', text: 'Microsoft UET queue (uetq) found on the page' + (uet.kind ? ' — ' + uet.kind : '') }));
  else bar.appendChild(h('div', { class: 'p', text: 'Microsoft UET tag not detected on this page' }));
  if ((uet.tagSeen || uet.apiFound) && !uet.adStorage) bar.appendChild(h('div', { class: 'p', text: 'No consent signal reported yet. This site may not have Microsoft Consent Mode configured.' }));
  root.appendChild(bar);
  if (!uet.tagSeen && !uet.apiFound) return;

  if (uet.adStorage) {
    root.appendChild(h('h2', { text: 'UET Consent Data' }));
    root.appendChild(table(['Signal', 'Value'], [['ad_storage', h('span', { class: 'state ' + uet.adStorage, text: uet.adStorage + (uet.adStorageSource ? '  (' + uet.adStorageSource + ')' : '') })], ['latest asc', uet.latestAsc || '—']]));
  }
  if (uet.config) {
    root.appendChild(h('h3', { text: 'uetConfig' }));
    const c = uet.config.consent || {}, t = uet.config.tcf || {};
    root.appendChild(flagRow([['consent.enabled', c.enabled], ['adStorageAllowed', c.adStorageAllowed], ['adStorageUpdated', c.adStorageUpdated], ['waitForUpdate', c.waitForUpdate], ['enforced', c.enforced, true], ['tcf.enabled', t.enabled], ['tcf.hasVendor(1126)', t.hasVendor], ['tcf.gdprApplies', t.gdprApplies]]));
  }
  if (uet.events.length) {
    root.appendChild(h('h2', { text: 'uetq consent pushes' }));
    const log = h('div', { class: 'event-log' });
    for (const ev of uet.events.slice(-20)) log.appendChild(eventRow(ev.timestamp, pill(ev.data.command === 'update' ? 'update' : 'default', ev.data.command), h('span', { text: JSON.stringify(ev.data.params || {}) })));
    root.appendChild(log);
  }
  if (uet.tagRequests.length) {
    const ul = h('ul', { class: 'check-list' });
    for (const r of uet.tagRequests.slice(-20)) ul.appendChild(checkItem(r.asc === 'G' ? '✓' : r.asc === 'D' ? '✗' : '·', fmtTime(r.timestamp) + '  ' + r.host + r.path + (r.evt ? ' evt=' + r.evt : '') + (r.asc ? ' asc=' + r.asc : ' (no asc)') + (r.gasc ? ' gasc=' + r.gasc : '') + (r.tcf ? ' tcf=' + r.tcf : '')));
    root.appendChild(section('uet-beacons', 'bat.bing.com / bat.bing.net beacons', ul, { count: uet.tagRequests.length, open: true }));
    if (uet.tagRequests.some((r) => r.host === 'bat.bing.net')) root.appendChild(h('p', { class: 'muted small', text: 'bat.bing.net is the cookieless host UET switches to while ad storage is not allowed.' }));
  }
}
