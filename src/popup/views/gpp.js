import { h, clear, findingsList, table, jsonBox, checkItem, section, empty, fmtTime } from '../components.js';
import { decodeGppHeader } from '../../shared/gpp/gpp_header.js';

export function render(ctx, root) {
  clear(root);
  const { tab, findings } = ctx;
  const g = tab.gpp || {};
  const diag = tab.diagnostics || {};
  const ping = g.ping ? g.ping.data : null;
  root.appendChild(findingsList(findings.filter((f) => f.tab === 'gpp')));

  const bar = h('div', { class: 'pillbar' });
  if (g.apiFound || ping) bar.appendChild(h('div', { class: 'p ok', text: 'IAB GPP API detected' + (g.locatorFound ? ' (with __gppLocator frame)' : '') }));
  else if (diag.cmp) bar.appendChild(h('div', { class: 'p warn', text: 'IAB GPP stub code is missing (a ' + diag.cmp.name + ' CMP is present but window.__gpp does not exist).' }));
  else bar.appendChild(h('div', { class: 'p', text: 'IAB GPP API not detected on this page' }));
  root.appendChild(bar);
  if (!ping && !g.data) return;

  if (ping) {
    root.appendChild(h('h2', { text: 'GPP Consent Data' }));
    const rows = [];
    for (const k of ['gppVersion', 'cmpStatus', 'cmpDisplayStatus', 'signalStatus', 'cmpId', 'supportedAPIs', 'applicableSections', 'sectionList', 'gppString']) {
      if (ping[k] === undefined) continue;
      rows.push([k, h('span', { class: k === 'gppString' ? 'mono' : '', text: typeof ping[k] === 'object' ? JSON.stringify(ping[k]) : String(ping[k]) })]);
    }
    root.appendChild(table(['Field', 'Value'], rows));
    if (ping.gppString) {
      const hd = decodeGppHeader(ping.gppString);
      const ul = h('ul', { class: 'check-list' });
      if (!hd.valid) ul.appendChild(checkItem('✗', 'Header: ' + hd.error));
      else {
        ul.appendChild(checkItem('✓', 'Header version ' + hd.version + ' · ' + hd.sectionIds.length + ' section id(s) · ' + hd.segmentCount + ' section segment(s)' + (hd.mismatch ? ' — mismatch' : '')));
        for (const s of hd.sections) ul.appendChild(checkItem('·', s.name, s.id));
        if (hd.note) ul.appendChild(checkItem('!', hd.note));
      }
      root.appendChild(section('gpp-header', 'GPP header decode', ul, { open: true }));
    }
    if (Object.keys(g.sections || {}).length) {
      const ul2 = h('ul', { class: 'check-list' });
      for (const [prefix, present] of Object.entries(g.sections)) ul2.appendChild(checkItem(present ? '✓' : '✗', 'hasSection(' + prefix + ') → ' + present));
      root.appendChild(section('gpp-sections', 'Sections (hasSection probes)', ul2));
    }
    if (Object.keys(g.commands || {}).length) {
      const ul3 = h('ul', { class: 'check-list' });
      for (const [c, r] of Object.entries(g.commands)) ul3.appendChild(checkItem(r.ok ? '✓' : '✗', c + (r.note ? ' — ' + r.note : '')));
      root.appendChild(section('gpp-commands', 'GPP 1.1 commands', ul3));
    }
  }
  if ((g.events || []).length) {
    const ul = h('ul', { class: 'check-list' });
    for (const e of g.events.slice(-20)) ul.appendChild(checkItem('·', fmtTime(e.timestamp) + '  ' + (e.data && e.data.eventName) + (e.data && e.data.data != null && typeof e.data.data !== 'object' ? ' = ' + e.data.data : '')));
    root.appendChild(section('gpp-events', 'GPP events', ul, { count: g.events.length }));
  }
  if ((g.errors || []).length) {
    const ul = h('ul', { class: 'check-list' });
    for (const e of g.errors) ul.appendChild(checkItem('✗', fmtTime(e.timestamp) + ' ' + (e.data && e.data.where) + ': ' + (e.data && e.data.message)));
    root.appendChild(section('gpp-errors', '__gpp errors', ul, { count: g.errors.length }));
  }
  root.appendChild(jsonBox('GPP Consent Data JSON', { ping, legacyGetGPPData: g.data && g.data.data, lastEvent: g.events && g.events.length ? g.events[g.events.length - 1].data : null }));
  if (!ping && g.data) root.appendChild(empty('Only the legacy getGPPData response was returned (GPP 1.0 CMP).'));
}
