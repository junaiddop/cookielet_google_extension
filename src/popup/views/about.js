import { h, clear, externalLink } from '../components.js';
import { URLS } from '../../shared/constants.js';

const FEATURES = [
  ['Google Consent Mode v2 Checker', 'Consent default/update calls from dataLayer, Google\'s own google_tag_data.ics state, tag loading order, gcs/gcd/tcfd network signals and Signal Breakdown.'],
  ['IAB TCF v2.2 / v2.3 validator', 'CMP-Validator parity: cmp-list and GVL lookups, 13 technical and 32 policy compliance checks, CMP API command check, TC string decode and manual paste, purposes/features/vendors with names, Google Additional Consent.'],
  ['IAB GPP inspector', '__gpp ping/events, GPP 1.1 command and section probes, header decode with section names.'],
  ['Microsoft UET consent', 'uetq consent pushes, UET instance config and bat.bing.com/.net beacons (asc parameter).'],
  ['Reports', 'Export the inspection as JSON or an IAB-style CSV compliance report; manual answers are stored per site.']
];

export function render(ctx, root) {
  clear(root);
  const version = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : '';
  const box = h('div', { class: 'about' });
  box.appendChild(h('h2', { text: 'About Cookielet Consent Inspector' }));
  box.appendChild(h('p', { class: 'muted', text: 'Verify compliance with the IAB Transparency & Consent Framework, the Global Privacy Platform, Google Consent Mode and Microsoft Consent Mode by checking how consent is captured and transmitted on any page.' }));
  FEATURES.forEach(([title, desc], i) => box.appendChild(h('div', { class: 'card' }, h('span', { class: 'n', text: String(i + 1) }), h('div', null, h('div', null, h('strong', { text: title })), h('div', { class: 'd', text: desc })))));
  box.appendChild(h('h3', { text: 'How to use' }));
  box.appendChild(h('ul', null,
    h('li', { text: 'Open the inspector, then reload the page so boot-time events (consent default, tag order, stub replacement) are captured from document_start.' }),
    h('li', { text: 'Use the Side panel to keep it open while you accept/reject in the banner; the views update live.' }),
    h('li', { text: 'Re-probe asks the page to re-run every __tcfapi / __gpp probe and re-send its state. Clear forgets the tab.' }),
    h('li', { text: 'Manual policy checks are answered on the IAB TCF tab and stored per site; Export CSV produces the IAB-style report.' })));
  box.appendChild(h('h3', { text: 'References' }));
  const refs = h('p', { class: 'small' });
  [[URLS.GCM_GUIDE, 'Google Consent Mode guide'], [URLS.TCF_POLICY, 'IAB Europe TCF'], [URLS.TCF_SPEC, 'TCF technical specifications'], [URLS.GPP_SPEC, 'IAB GPP'], [URLS.COMPLAINT_FORM, 'TCF non-compliance form'], [URLS.COOKIELET, 'Cookielet']].forEach(([u, t], i) => { if (i) refs.appendChild(h('span', { text: ' · ' })); refs.appendChild(externalLink(u, t)); });
  box.appendChild(refs);
  box.appendChild(h('p', { class: 'muted small', text: 'Version ' + version + ' · Cookielet CMP ID 503 · Debug logging can be enabled from the footer (Shift+click "Re-probe").' }));
  root.appendChild(box);
}
