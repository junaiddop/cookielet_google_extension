/**
 * Tiny DOM helpers for the popup (ESM, browser only).
 * Everything untrusted goes through textContent — there is no innerHTML here.
 */

/**
 * h('div', {class:'x', text:'hi', title:'t', data-id:'1', onclick: fn}, child1, 'text', …)
 * `text` sets textContent; `html` is intentionally unsupported.
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = String(v);
      else if (k === 'class') el.className = v;
      else if (k === 'title') el.title = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'hidden') el.hidden = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) append(el, c);
  return el;
}

export function append(el, c) {
  if (c == null || c === false) return el;
  if (Array.isArray(c)) { c.forEach((x) => append(el, x)); return el; }
  el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  return el;
}

export function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }

export function replaceChildren(el, ...children) { clear(el); children.forEach((c) => append(el, c)); return el; }

function pad(n, l = 2) { return String(n).padStart(l, '0'); }

/** 13:05:09.123 (local time). */
export function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d)) return '-';
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
}

/** 2026-08-01 00:00:00 (UTC, from ISO or ms). */
export function fmtDateTime(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}

export function fmtAgo(ts) {
  if (!ts) return '-';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

/** Button that copies text to the clipboard and confirms inline. */
export function copyButton(getText, label = 'Copy') {
  const btn = h('button', { class: 'copy-btn', type: 'button', text: label });
  btn.addEventListener('click', async () => {
    try {
      const text = typeof getText === 'function' ? getText() : String(getText);
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch (e) {
      btn.textContent = 'Copy failed';
    }
    setTimeout(() => { btn.textContent = label; }, 1500);
  });
  return btn;
}

export function truncate(s, n = 60) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function externalLink(href, text) {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', text: text || href });
}

export default { h, append, clear, replaceChildren, fmtTime, fmtDateTime, fmtAgo, copyButton, truncate, externalLink };
