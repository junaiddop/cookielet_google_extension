import { h, clear, findingsList, section, resultTag, kv, table, checkItem, jsonBox, rawBox, copyButton, externalLink, empty, fmtTime } from '../components.js';
import { PURPOSE_NAMES, SPECIAL_FEATURE_NAMES, RESTRICTION_TYPES, LI_FORBIDDEN_PURPOSES, decode } from '../../shared/tcf/tc_decoder.js';
import { getSections, summarize, checkResult, resultLabel, flattenCmpApi } from '../../shared/tcf/policy_checks.js';
import { fmtDateTime, fmtAgo } from '../../shared/util/dom.js';
import { URLS, TCF_MAX_AGE_MS } from '../../shared/constants.js';

function checkRow(check, value, detail, { manual, onAnswer, infoOpen, toggleInfo }) {
  const row = h('div', { class: 'check-row' },
    h('span', { class: 'num', text: String(check.number) }),
    h('span', { class: 'text' }, h('span', { text: check.text }), detail ? h('span', { class: 'detail', text: detail }) : null));
  const ctl = h('span', { class: 'ctl' });
  if (check.manualSteps || check.policyReference) ctl.appendChild(h('button', { class: 'btn btn-small icon', type: 'button', title: 'Manual steps and policy reference', text: 'ℹ', onclick: () => toggleInfo(check.id) }));
  if (check.automated) ctl.appendChild(resultTag(resultLabel(value)));
  else {
    ctl.appendChild(h('button', { class: 'btn btn-small' + (value === true ? ' on-pass' : ''), type: 'button', text: 'Pass', onclick: () => onAnswer(check.id, value === true ? null : true) }));
    ctl.appendChild(h('button', { class: 'btn btn-small' + (value === false ? ' on-fail' : ''), type: 'button', text: 'Fail', onclick: () => onAnswer(check.id, value === false ? null : false) }));
    if (value == null) ctl.appendChild(h('span', { class: 'result-tag incomplete', title: 'Not answered yet', text: '?' }));
  }
  row.appendChild(ctl);
  const frag = document.createDocumentFragment();
  frag.appendChild(row);
  if (infoOpen) {
    const panel = h('div', { class: 'info-panel' });
    if (check.manualSteps) { panel.appendChild(h('h4', { text: 'Manual steps required for this check' })); panel.appendChild(h('div', { text: check.manualSteps })); }
    if (check.policyReference) { panel.appendChild(h('h4', { text: 'Policy Reference (TCF v2)' })); panel.appendChild(h('div', { text: check.policyReference })); }
    frag.appendChild(panel);
  }
  return frag;
}

function idRows(ids, nameOf, total) {
  if (!ids || !ids.length) return empty('None.');
  const box = h('div', { class: 'id-list' });
  for (const id of ids) box.appendChild(h('div', { class: 'row' }, h('span', { class: 'id', text: String(id) }), h('span', { text: nameOf(id) || ('vendor ' + id) })));
  if (total != null) box.appendChild(h('div', { class: 'row muted', text: ids.length + ' of ' + total + ' listed in the GVL' }));
  return box;
}

export function render(ctx, root) {
  clear(root);
  const { tab, models, findings, gvlState, manual, actions, checksData, ui } = ctx;
  const tcf = models.tcf;
  const own = findings.filter((f) => f.tab === 'tcf');
  root.appendChild(findingsList(own));

  if (!tcf.present) {
    root.appendChild(h('div', { class: 'summary-card' },
      h('p', null, h('strong', { text: 'No CMP API found on this webpage.' })),
      h('p', { class: 'muted', text: 'Neither window.__tcfapi nor a __tcfapiLocator frame was detected.' + (tab.diagnostics && tab.diagnostics.cmp ? ' A ' + tab.diagnostics.cmp.name + ' CMP is present but its TCF integration is not active.' : '') })));
    return;
  }

  const gvl = gvlState && gvlState.gvl, cmpList = gvlState && gvlState.cmpList;
  const sections = getSections(checksData);
  const auto = tcf.technical.results;
  const techSum = summarize(sections.technical, auto, manual);
  const polSum = summarize(sections.policy, {}, manual);
  const d = tcf.decoded && !tcf.decoded.error ? tcf.decoded : null;

  /* summary */
  const card = h('div', { class: 'summary-card' });
  card.appendChild(h('div', { class: 'kv' },
    kv('CMP Found', tcf.cmpName, tcf.cmpRegistered === false),
    kv('CMP Id', tcf.cmpId),
    kv('CMP Version', tcf.cmpVersion),
    kv('TCF API Version', tcf.apiVersion || (d ? 'string v' + d.version : null)),
    kv('TCF Policy Version', tcf.tcfPolicyVersion),
    kv('GDPR Applies', tcf.gdprApplies, tcf.gdprApplies === false),
    kv('Event Status', tcf.eventStatus),
    kv('CMP Status', tcf.cmpStatus, tcf.cmpStatus === 'error'),
    kv('Display Status', tcf.displayStatus),
    kv('GVL version (ping)', tcf.gvlVersion)));
  if (tcf.summaryLines.length) {
    const counts = h('div', { class: 'counts' });
    for (const line of tcf.summaryLines) { const m = line.match(/^(.*?:)\s*(\d+)$/); counts.appendChild(m ? h('p', null, m[1] + ' ', h('span', { text: m[2] })) : h('p', { text: line })); }
    card.appendChild(counts);
  }
  const status = h('div', { class: 'counts' });
  status.appendChild(h('p', null, 'Technical Compliance Checks ', h('span', { text: 'passed: ' + techSum.passed + ', failed: ' + techSum.failed + ', to do: ' + techSum.todo })));
  status.appendChild(h('p', null, 'Policy Compliance Checks ', h('span', { text: 'passed: ' + polSum.passed + ', failed: ' + polSum.failed + ', to do: ' + polSum.todo })));
  card.appendChild(status);
  root.appendChild(card);

  const opts = { manual, onAnswer: actions.setManual, toggleInfo: actions.toggleInfo };

  /* technical checks */
  const techBody = h('div');
  for (const c of sections.technical) techBody.appendChild(checkRow(c, checkResult(c, auto, manual), c.automated ? tcf.technical.details[c.id] : null, { ...opts, infoOpen: ui.infoOpen.has(c.id) }));
  root.appendChild(section('tcf-technical', 'Technical Compliance Checks', techBody, { count: techSum.passed + '/' + techSum.total, result: techSum.status, open: true }));

  /* policy checks */
  const polBody = h('div');
  polBody.appendChild(h('p', { class: 'muted small', text: 'Manual checks — answer them while reviewing the banner. Answers are stored per site (' + ctx.host + ') and included in the CSV report.' }));
  for (const c of sections.policy) polBody.appendChild(checkRow(c, checkResult(c, {}, manual), null, { ...opts, infoOpen: ui.infoOpen.has(c.id) }));
  root.appendChild(section('tcf-policy', 'Policy Compliance Checks', polBody, { count: polSum.passed + '/' + polSum.total, result: polSum.status }));

  /* CMP and TCF API check */
  const apiBody = h('div');
  let group = null;
  let ul = null;
  for (const c of flattenCmpApi(sections.cmpApi)) {
    if (c.groupTitle !== group) { group = c.groupTitle; apiBody.appendChild(h('h3', { text: group })); ul = h('ul', { class: 'check-list' }); apiBody.appendChild(ul); }
    const grp = c.id.split('_')[1];
    const val = tcf.apiRows[grp] ? tcf.apiRows[grp][c.key] : '-';
    const mark = val === 'true' ? '✓' : val === 'false' ? '✗' : '·';
    ul.appendChild(checkItem(mark, c.text + ': ' + val + (c.key === 'getTCDataResponse' ? ' (deprecated in v2.2)' : '')));
  }
  if (tcf.pingHistory.length > 1) {
    apiBody.appendChild(h('h3', { text: 'ping history' }));
    const pl = h('ul', { class: 'check-list' });
    for (const p of tcf.pingHistory) pl.appendChild(checkItem('·', fmtTime(p.timestamp) + '  cmpStatus=' + p.cmpStatus + ' cmpLoaded=' + p.cmpLoaded + ' displayStatus=' + p.displayStatus + ' gdprApplies=' + p.gdprApplies));
    apiBody.appendChild(pl);
  }
  root.appendChild(section('tcf-api', 'CMP and TCF API check', apiBody));

  /* TC string check */
  const tcBody = h('div');
  if (tcf.gdprApplies === false && !tcf.tcString) tcBody.appendChild(h('p', { class: 'state amber', text: 'not applicable — GDPR does not apply' }));
  else if (!tcf.tcString) tcBody.appendChild(empty(tcf.eventStatus === 'cmpuishown' ? 'The CMP UI is shown; a TC string is produced after the user acts.' : 'The CMP has not produced a TC string yet.'));
  else {
    tcBody.appendChild(h('p', null, h('strong', { text: 'TC String (via CMP API) — ' + (d ? d.byteSize : tcf.tcString.length) + ' bytes' }), copyButton(() => tcf.tcString)));
    tcBody.appendChild(rawBox(tcf.tcString));
    if (d) {
      const age = Date.now() - d.lastUpdatedMs;
      const ul2 = h('ul', { class: 'check-list' });
      ul2.appendChild(checkItem(d.version === 2 ? '✓' : '✗', 'Version: ' + d.version));
      ul2.appendChild(checkItem(tcf.cmpRegistered === false ? '✗' : (tcf.cmpRegistered ? '✓' : '·'), 'CMP ID ' + d.cmpId + (tcf.cmpName ? ' (' + tcf.cmpName + ')' : '')));
      ul2.appendChild(checkItem(d.hasDisclosedVendorsSegment ? '✓' : '✗', 'Segments: ' + d.segments.map((s) => s.name).join(' + ') + (d.hasDisclosedVendorsSegment ? '' : ' — DisclosedVendors missing (mandatory since TCF v2.3)')));
      ul2.appendChild(checkItem(d.isServiceSpecific ? '✓' : '✗', 'Service-specific: ' + d.isServiceSpecific));
      ul2.appendChild(checkItem(age <= TCF_MAX_AGE_MS ? '✓' : '!', 'Last updated ' + fmtDateTime(d.lastUpdatedMs) + ' (' + fmtAgo(d.lastUpdatedMs) + ')'));
      ul2.appendChild(checkItem(d.createdMs === d.lastUpdatedMs ? '✓' : '✗', 'Created ' + fmtDateTime(d.createdMs)));
      ul2.appendChild(checkItem(gvl ? (d.tcfPolicyVersion === gvl.tcfPolicyVersion ? '✓' : '✗') : '·', 'Policy version ' + d.tcfPolicyVersion + (gvl ? ' (latest GVL: ' + gvl.tcfPolicyVersion + ')' : '')));
      ul2.appendChild(checkItem('·', 'Consent language ' + d.consentLanguage + ' · Publisher country ' + d.publisherCC + ' · Consent screen ' + d.consentScreen + ' · GVL v' + d.vendorListVersion));
      if (d.useNonStandardTexts) ul2.appendChild(checkItem('!', 'UseNonStandardTexts flag set'));
      if (d.purposeOneTreatment) ul2.appendChild(checkItem('!', 'PurposeOneTreatment flag set (purpose 1 not disclosed in this country)'));
      if (d.segmentErrors.length) ul2.appendChild(checkItem('✗', d.segmentErrors.join('; ')));
      tcBody.appendChild(ul2);
    } else if (tcf.decoded && tcf.decoded.error) tcBody.appendChild(h('p', { class: 'state denied', text: 'Decode failed: ' + tcf.decoded.error }));
  }
  root.appendChild(section('tcf-string', 'TC String Check', tcBody, { open: true }));

  /* purposes / features / vendors */
  if (d) {
    const pName = (id) => (gvl && gvl.purposes[id] && gvl.purposes[id].name) || PURPOSE_NAMES[id] || 'Purpose ' + id;
    const sfName = (id) => (gvl && gvl.specialFeatures[id] && gvl.specialFeatures[id].name) || SPECIAL_FEATURE_NAMES[id] || 'Special feature ' + id;
    const vName = (id) => (gvl && gvl.vendors[id] && (gvl.vendors[id].name + (gvl.vendors[id].deletedDate ? ' (deleted)' : ''))) || null;
    const purposeIds = gvl ? Object.keys(gvl.purposes).map(Number) : Object.keys(PURPOSE_NAMES).map(Number);
    const sfIds = gvl ? Object.keys(gvl.specialFeatures).map(Number) : [1, 2];
    const apiP = tcf.tcData && tcf.tcData.purpose;

    const pc = h('ul', { class: 'check-list' });
    for (const p of purposeIds) pc.appendChild(checkItem(d.purposeConsents.includes(p) ? '✓' : '✗', pName(p) + (apiP && apiP.consents && !!apiP.consents[p] !== d.purposeConsents.includes(p) ? '  (API differs)' : ''), p));
    root.appendChild(section('tcf-purposes-c', 'Purposes (Consent)', pc, { count: d.purposeConsents.length + '/' + purposeIds.length }));
    const pli = h('ul', { class: 'check-list' });
    for (const p of purposeIds) {
      const on = d.purposeLegitimateInterests.includes(p);
      const forbidden = LI_FORBIDDEN_PURPOSES.includes(p);
      pli.appendChild(checkItem(on ? (forbidden ? '!' : '✓') : (forbidden ? '·' : '✗'), pName(p) + (forbidden ? ' — consent only (LI not allowed)' : ''), p, forbidden));
    }
    root.appendChild(section('tcf-purposes-li', 'Purposes (Legitimate Interest)', pli, { count: d.purposeLegitimateInterests.length }));
    const sf = h('ul', { class: 'check-list' });
    for (const f of sfIds) sf.appendChild(checkItem(d.specialFeatureOptIns.includes(f) ? '✓' : '✗', sfName(f), f));
    root.appendChild(section('tcf-special', 'Special Features', sf, { count: d.specialFeatureOptIns.length + '/' + sfIds.length }));
    const total = gvl ? Object.keys(gvl.vendors).length : null;
    root.appendChild(section('tcf-vendors-c', 'Vendors (Consent)', idRows(d.vendorConsents, vName, total), { count: d.vendorConsents.length }));
    root.appendChild(section('tcf-vendors-li', 'Vendors (Legitimate Interest)', idRows(d.vendorLegitimateInterests, vName, total), { count: d.vendorLegitimateInterests.length }));
    root.appendChild(section('tcf-vendors-d', 'Vendors (Disclosed)', d.hasDisclosedVendorsSegment ? idRows(d.disclosedVendors, vName, total) : h('p', { class: 'state denied', text: 'No DisclosedVendors segment in the TC string.' }), { count: (d.disclosedVendors || []).length }));
    if (d.publisherRestrictions.length) {
      const pr = h('ul', { class: 'check-list' });
      for (const r of d.publisherRestrictions) pr.appendChild(checkItem(r.restrictionType === 3 ? '✗' : '·', 'Purpose ' + r.purposeId + ' (' + pName(r.purposeId) + ') — ' + (RESTRICTION_TYPES[r.restrictionType] || r.restrictionType) + ' — ' + r.vendors.length + ' vendor(s): ' + r.vendors.slice(0, 30).join(', ') + (r.vendors.length > 30 ? '…' : '')));
      root.appendChild(section('tcf-restrictions', 'Publisher Restrictions', pr, { count: d.publisherRestrictions.length }));
    }
    if (d.publisherTC) {
      const pt = h('ul', { class: 'check-list' });
      pt.appendChild(checkItem('·', 'Publisher purpose consents: ' + (d.publisherTC.purposeConsents.join(', ') || 'none')));
      pt.appendChild(checkItem('·', 'Publisher purpose LI: ' + (d.publisherTC.purposeLegitimateInterests.join(', ') || 'none')));
      if (d.publisherTC.numCustomPurposes) pt.appendChild(checkItem('·', 'Custom purposes: ' + d.publisherTC.numCustomPurposes + ' (consents ' + (d.publisherTC.customPurposeConsents.join(', ') || 'none') + ')'));
      root.appendChild(section('tcf-pubtc', 'Publisher TC segment', pt));
    }
  }

  /* Additional Consent */
  const ac = tcf.ac;
  if (ac) {
    const acBody = h('div');
    acBody.appendChild(rawBox(ac.raw));
    if (ac.valid) {
      const atpName = (id) => (ac.names && ac.names[id]) || (gvlState && gvlState.atp ? 'not on Google\'s ATP list' : null);
      acBody.appendChild(h('p', null, h('strong', { text: 'Version ' + ac.version + ' · Consented ATPs (' + ac.consented.length + ')' })));
      acBody.appendChild(idRows(ac.consented, atpName));
      if (ac.version === 2) { acBody.appendChild(h('p', null, h('strong', { text: 'Disclosed, not consented (' + ac.disclosed.length + ')' }))); acBody.appendChild(idRows(ac.disclosed, atpName)); }
      if (ac.duplicates.length) acBody.appendChild(h('p', { class: 'state amber', text: 'Ids in both parts: ' + ac.duplicates.join(', ') }));
    } else acBody.appendChild(h('p', { class: 'state denied', text: 'Unrecognized AC string format.' }));
    root.appendChild(section('tcf-ac', 'Google Additional Consent (ATP)', acBody, { count: ac.valid ? ac.consented.length : null }));
  }

  /* storage */
  if (tcf.storage) {
    const sb = h('ul', { class: 'check-list' });
    for (const [k, v] of Object.entries(tcf.storage)) sb.appendChild(checkItem(k === 'IABTCF_TCString' ? (v === tcf.tcString ? '✓' : '✗') : '·', k + ' = ' + (String(v).length > 80 ? String(v).slice(0, 80) + '…' : v)));
    root.appendChild(section('tcf-storage', 'IABTCF_* storage', sb, { count: Object.keys(tcf.storage).length }));
  }

  /* history + errors + raw */
  if (tcf.history.length) {
    const hl = h('ul', { class: 'check-list' });
    for (const e of tcf.history.slice(-20)) hl.appendChild(checkItem('·', fmtTime(e.timestamp) + '  ' + e.eventStatus + ' · ' + e.cmpStatus + (e.tcString ? ' · ' + e.tcString.slice(0, 24) + '…' : ' · (no TC string)')));
    root.appendChild(section('tcf-history', 'TCData events', hl, { count: tcf.history.length }));
  }
  if (tcf.errors.length) {
    const el = h('ul', { class: 'check-list' });
    for (const e of tcf.errors.slice(-10)) el.appendChild(checkItem('✗', fmtTime(e.timestamp) + ' ' + ((e.data && e.data.where) || '') + ': ' + ((e.data && e.data.message) || '')));
    root.appendChild(section('tcf-errors', '__tcfapi errors', el, { count: tcf.errors.length }));
  }
  if (tcf.tcData) root.appendChild(section('tcf-json', 'IAB TCF Consent JSON', jsonBox('TCData (latest addEventListener callback)', tcf.tcData)));

  /* footer */
  const foot = h('p', { class: 'muted small' });
  foot.appendChild(externalLink(URLS.COMPLAINT_FORM, 'File a complaint with IAB Europe'));
  foot.appendChild(h('span', { text: ' · ' }));
  if (gvl) foot.appendChild(h('span', { text: 'GVL v' + gvl.vendorListVersion + ' (policy ' + gvl.tcfPolicyVersion + ') fetched ' + fmtAgo(gvlState.fetchedAt) + (cmpList ? ' · CMP list ' + Object.keys(cmpList.cmps).length + ' CMPs' : '') + ' ' }));
  else foot.appendChild(h('span', { text: 'GVL not loaded' + (gvlState && gvlState.errors && gvlState.errors.gvl ? ' (' + gvlState.errors.gvl + ')' : '') + ' ' }));
  foot.appendChild(h('button', { class: 'btn btn-small', type: 'button', text: 'Refresh GVL', onclick: () => actions.refreshGvl() }));
  root.appendChild(foot);
}

/** Manual paste box (static DOM, outside the re-rendered subtree). */
export function renderManualPaste(ctx, textarea, result) {
  const text = (textarea.value || '').trim();
  textarea.classList.remove('match', 'mismatch');
  clear(result);
  if (!text) { result.textContent = 'Nothing pasted.'; result.className = 'muted'; return; }
  const d = decode(text);
  const api = ctx.models.tcf.tcString;
  if (d.error) { result.className = 'state denied'; result.textContent = 'Decode failed: ' + d.error; return; }
  result.className = '';
  const ul = h('ul', { class: 'check-list' });
  ul.appendChild(checkItem('·', d.byteSize + ' bytes · CMP ' + d.cmpId + ' v' + d.cmpVersion + ' · GVL v' + d.vendorListVersion + ' · policy ' + d.tcfPolicyVersion + ' · created ' + fmtDateTime(d.createdMs)));
  ul.appendChild(checkItem('·', 'Purposes consent ' + (d.purposeConsents.join(', ') || 'none') + ' · LI ' + (d.purposeLegitimateInterests.join(', ') || 'none') + ' · special features ' + (d.specialFeatureOptIns.join(', ') || 'none')));
  ul.appendChild(checkItem('·', 'Vendors consent ' + d.vendorConsents.length + ' · LI ' + d.vendorLegitimateInterests.length + ' · disclosed ' + (d.disclosedVendors || []).length + ' · segments ' + d.segments.map((s) => s.name).join(' + ')));
  if (api) {
    const same = api === text;
    textarea.classList.add(same ? 'match' : 'mismatch');
    ul.appendChild(checkItem(same ? '✓' : '✗', same ? 'Identical to the TC string returned by the CMP API' : 'Differs from the TC string returned by the CMP API'));
  } else ul.appendChild(checkItem('·', 'No CMP TC string on this page to compare with'));
  result.appendChild(ul);
}
