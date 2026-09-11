/** Shared popup components (ESM, browser). All data flows through textContent. */
import { h, clear, fmtTime, copyButton, externalLink } from '../shared/util/dom.js';

export function statusCard(name, value, cls, sub) {
  const nameEl = h('span', { class: 'name', text: name });
  if (sub) nameEl.appendChild(h('span', { class: 'sub', text: sub }));
  return h('div', { class: 'status-card ' + (cls || '') }, nameEl,
    h('span', { class: 'badge badge-' + (cls === 'ok' ? 'ok' : cls === 'warn' ? 'warn' : cls === 'err' ? 'err' : 'muted'), text: value }));
}

export function banner(status, message) {
  const label = { pass: 'Passed', info: 'Info', warning: 'Warning', error: 'Error' }[status] || 'Info';
  return h('div', { class: 'banner ' + status }, h('span', { class: 'label', text: label + ':' }), h('span', { text: message }));
}

export function findingsList(findings) {
  const box = h('div', { class: 'findings' });
  for (const f of findings) {
    const sevLabel = f.sev === 'err' ? 'Error' : f.sev === 'warn' ? 'Warning' : 'Info';
    const row = h('div', { class: 'finding ' + f.sev },
      h('span', { class: 'sev', text: sevLabel + ' · ' + f.area }),
      h('span', { class: 'msg', text: f.msg }));
    if (f.link && /^https?:/.test(f.link)) row.appendChild(externalLink(f.link, f.linkText || 'Learn more'));
    box.appendChild(row);
  }
  return box;
}

/** Collapsible section with a stable data-key (open state is preserved across renders by main.js). */
export function section(key, title, bodyEl, { count = null, open = false, result = null } = {}) {
  const summary = h('summary', null, title + ' ');
  if (count != null) summary.appendChild(h('span', { class: 'count', text: '(' + count + ')' }));
  if (result) summary.appendChild(resultTag(result));
  const det = h('details', { class: 'section', 'data-key': key }, summary, h('div', { class: 'body' }, bodyEl));
  if (open) det.setAttribute('open', '');
  return det;
}

export function resultTag(label) {
  const cls = label === 'Passed' ? 'passed' : label === 'Failed' ? 'failed' : 'incomplete';
  return h('span', { class: 'result-tag ' + cls + ' result', text: label });
}

export function kv(label, value, bad) {
  return h('p', null, h('strong', { text: label + ': ' }), h('span', { class: bad ? 'bad' : '', text: value == null || value === '' ? '-' : String(value) }));
}

export function stateSpan(v, extra) {
  if (v === 'granted') return h('span', { class: 'state granted', text: 'granted' + (extra ? ' ' + extra : '') });
  if (v === 'denied') return h('span', { class: 'state denied', text: 'denied' + (extra ? ' ' + extra : '') });
  if (typeof v === 'object' && v && v.regionScoped) return h('span', { class: 'state amber', text: 'region-scoped: ' + v.values.join('/') + ' (' + v.regions.join(', ') + ')' });
  return h('span', { class: 'state notset', text: v == null ? '—' : String(v) });
}

export function table(headers, rows, { mono = [] } = {}) {
  const thead = h('thead', null, h('tr', null, ...headers.map((t) => h('th', { text: t }))));
  const tbody = h('tbody');
  for (const r of rows) tbody.appendChild(h('tr', null, ...r.map((c, i) => c instanceof Node ? h('td', { class: mono.includes(i) ? 'mono' : '' }, c) : h('td', { class: mono.includes(i) ? 'mono' : '', text: c == null ? '' : String(c) }))));
  return h('table', { class: 'data-table' }, thead, tbody);
}

export function checkItem(mark, label, pid, grey) {
  const cls = mark === '✓' ? 'yes' : mark === '✗' ? 'no' : 'na';
  const li = h('li', { class: grey ? 'grey' : '' }, h('span', { class: 'mark ' + cls, text: mark }));
  if (pid != null) li.appendChild(h('span', { class: 'pid', text: String(pid) }));
  li.appendChild(h('span', { class: 'name', text: label }));
  return li;
}

export function jsonBox(title, obj) {
  const text = JSON.stringify(obj, null, 2);
  const box = h('div', null,
    h('div', { class: 'box-head' }, h('strong', { text: title }), copyButton(() => text, 'Copy')),
    h('pre', { class: 'json-box', text: text }));
  return box;
}

export function rawBox(text) { return h('div', { class: 'raw-output', text: text }); }

export function pill(cls, text) { return h('span', { class: 'pill ' + cls, text }); }

export function eventRow(ts, ...children) {
  return h('div', { class: 'event-row' }, h('span', { class: 't', text: fmtTime(ts) }), ...children);
}

export function flagRow(flags) {
  const row = h('div', { class: 'flag-row' });
  for (const [label, value, badWhenTrue] of flags) {
    const on = value === true;
    const cls = on ? (badWhenTrue ? 'bad' : 'on') : 'off';
    row.appendChild(h('span', { class: cls, text: label + ': ' + (value == null ? '—' : String(value)) }));
  }
  return row;
}

export function empty(text) { return h('p', { class: 'muted', text }); }

export { h, clear, fmtTime, copyButton, externalLink };
