/**
 * Report export (pure builders + a browser-only download helper).
 * CSV follows the IAB CMP Validator layout (`Id, Compliance Check Name, Result`)
 * with proper RFC 4180 quoting; JSON carries the whole state + models + findings.
 */
import { toCsv } from '../util/csv.js';
import { resultLabel, summarize, flattenCmpApi } from '../tcf/policy_checks.js';

const SUMMARY_LABELS = { cmpFound: 'CMP Found', cmpId: 'CMP Id', cmpVersion: 'CMP Version', tcfApiVersion: 'TCF API Version', tcfPolicyVersion: 'TCF Policy Version', gdprApplies: 'GDPR Applies' };

function ymd(d = new Date()) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }

export function safeHost(url) {
  try { return new URL(url).hostname || 'page'; } catch (e) { return 'page'; }
}

export function buildJsonReport({ tab, models, findings, manual, extensionVersion, gvlState }) {
  return {
    generatedAt: new Date().toISOString(),
    extensionVersion: extensionVersion || null,
    page: { url: tab && tab.pageUrl, title: tab && tab.title },
    findings,
    models: { gcm: models.gcm, tcf: models.tcf, gpp: models.gpp, uet: models.uet },
    manualResponses: manual || {},
    gvl: gvlState ? { vendorListVersion: gvlState.gvl && gvlState.gvl.vendorListVersion, cmpListUpdated: gvlState.cmpList && gvlState.cmpList.lastUpdated, fetchedAt: gvlState.fetchedAt } : null,
    tab
  };
}

/**
 * @param {object} p
 * @param {object} p.tcf            tcf model
 * @param {object} p.checks         parsed src/data/tcf_checks.json
 * @param {object} p.manual         {[checkId]: true|false}
 * @param {string} [p.manualTcString] pasted TC string (for the manual check row)
 */
export function buildCsvRows({ tcf, checks, manual = {}, manualTcString = '' }) {
  const rows = [['Id', 'Compliance Check Name', 'Result']];
  const push = (id, text, result) => rows.push([id == null ? '' : id, text == null ? '' : text, result == null ? '' : result]);
  const auto = (tcf && tcf.technical && tcf.technical.results) || {};

  // SUMMARY
  push('', 'SUMMARY', '');
  push('', '', '');
  const sv = {
    cmpFound: tcf && tcf.cmpName != null ? tcf.cmpName : '', cmpId: tcf && tcf.cmpId != null ? tcf.cmpId : '', cmpVersion: tcf && tcf.cmpVersion != null ? tcf.cmpVersion : '',
    tcfApiVersion: tcf && (tcf.apiVersion || (tcf.decoded && !tcf.decoded.error ? tcf.decoded.version : '')), tcfPolicyVersion: tcf && tcf.tcfPolicyVersion != null ? tcf.tcfPolicyVersion : '', gdprApplies: tcf && tcf.gdprApplies != null ? tcf.gdprApplies : ''
  };
  for (const k of Object.keys(SUMMARY_LABELS)) push('', SUMMARY_LABELS[k] + ': ' + sv[k], '');
  for (const line of (tcf && tcf.summaryLines) || []) push('', line, '');
  const tech = summarize(checks.technical, auto, manual);
  const pol = summarize(checks.policy, {}, manual);
  push('', 'Technical Compliance Checks passed: ' + tech.passed + ' failed: ' + tech.failed + ' to do: ' + tech.todo, '');
  push('', 'Policy Compliance Checks passed: ' + pol.passed + ' failed: ' + pol.failed + ' to do: ' + pol.todo, '');

  // TECHNICAL
  push('', '', '');
  push('', 'TECHNICAL COMPLIANCE CHECKS', tech.status);
  push('', '', '');
  for (const c of checks.technical) {
    const v = c.automated ? auto[c.id] : manual[c.id];
    const res = typeof v === 'boolean' ? resultLabel(v) : (c.automated ? 'Automatic check was not executed' : 'Manual check was not executed');
    push(c.number, c.text, res);
  }
  // POLICY
  push('', '', '');
  push('', 'POLICY COMPLIANCE CHECKS', pol.status);
  push('', '', '');
  for (const c of checks.policy) {
    const v = manual[c.id];
    push(c.number, c.text, typeof v === 'boolean' ? resultLabel(v) : 'Manual check was not executed');
  }
  // CMP AND TCF API CHECK
  push('', '', '');
  push('', 'CMP AND TCF API CHECK', '');
  push('', '', '');
  let lastGroup = null;
  for (const c of flattenCmpApi(checks.cmpApi)) {
    if (c.key === 'tcfVersion' || c.key === 'getTCDataResponse') continue; // validator parity
    if (c.groupTitle !== lastGroup) { push('', c.groupTitle, ''); push('', '', ''); lastGroup = c.groupTitle; }
    const group = c.id.split('_')[1];
    const val = tcf && tcf.apiRows && tcf.apiRows[group] ? tcf.apiRows[group][c.key] : '';
    push('', c.text, val == null ? '' : String(val));
  }
  // TC STRING
  push('', '', '');
  push('', 'TC String check', '');
  push('', '', '');
  push('', 'TC String (via CMP API)', '');
  const tcs = tcf && tcf.tcString;
  push('', tcs || (tcf && tcf.gdprApplies === false ? 'Gdpr applies: false' : ''), '');
  push('', (tcs ? tcf.decoded.byteSize : 0) + ' bytes', '');
  push('', ' ', '');
  const cmp = manualTcString && tcs ? manualTcString.trim() === tcs : null;
  push('', 'TC String manual check', resultLabel(cmp));
  push('', (manualTcString ? manualTcString.trim().length : 0) + ' bytes', '');
  return rows;
}

export function buildCsv(args) { return toCsv(buildCsvRows(args)); }

export function reportFilename(kind, url) {
  return 'cookielet-consent-report-' + safeHost(url) + '-' + ymd() + '.' + kind;
}

/** Browser only: trigger a download via a data: URL (no revoke race, no downloads permission). */
export function download(filename, mime, text) {
  const a = document.createElement('a');
  a.href = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text);
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { a.remove(); } catch (e) { /* ignore */ } }, 1000);
}

export default { buildJsonReport, buildCsvRows, buildCsv, reportFilename, download, safeHost };
