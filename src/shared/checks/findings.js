/**
 * Findings aggregator + badge status (pure, ESM).
 * A finding: {id, sev:'err'|'warn'|'info', area, tab:'gcm'|'tcf'|'gpp'|'uet', title, msg, link?, linkText?}
 */
import { TCF_MAX_AGE_MS, TCF_CURRENT_POLICY_VERSION, TCF_REQUIRED_COMMANDS, URLS } from '../constants.js';
import { runGcmChecks } from '../gcm/gcm_checks.js';
import { runUetChecks } from '../uet/uet_model.js';
import { apiVsStringDifferences } from '../tcf/tcf_model.js';
import { decodeGppHeader } from '../gpp/gpp_header.js';

const SEV_RANK = { err: 0, warn: 1, info: 2 };
const NOT_LOADED_GRACE_MS = 10000;
const CHECK_TEXTS = {
  4: 'Did all CMP API required commands return a correct response?', 5: 'Is the CMP registered?', 6: 'Is the GVL version format correct?',
  7: 'Is the current or penultimate version of the GVL being used?', 8: 'Is the max vendor id less than or equal to the highest id in the GVL?',
  9: "Are purposes 1, 3, 4, 5, and 6 set to 'no' for legitimate interest?", 10: 'Do the Created and LastUpdated fields have the same value?',
  11: 'Are the Created and LastUpdated timestamps imprecise?', 12: 'Are all vendor signals for deleted vendors set to 0?', 13: 'Does the TC String include the disclosedVendors segment?'
};

export function runTcfChecks(tab, tcf, { gvl = null, cmpList = null, now = Date.now() } = {}) {
  const out = [];
  const add = (id, sev, area, title, msg, link, linkText) => out.push({ id, sev, area, tab: 'tcf', title, msg, link, linkText });
  const diag = (tab && tab.diagnostics) || {};
  if (!tcf || !tcf.present) {
    if (diag.cmp && diag.cmp.name) {
      add('tcf.stub_missing', 'warn', 'IAB TCF', 'TCF stub missing', 'A CMP (' + diag.cmp.name + ') is present but neither window.__tcfapi nor a __tcfapiLocator frame exists — the IAB TCF stub code is missing or the TCF integration is disabled.');
    }
    return out;
  }
  const ping = tcf.ping || {};
  const startedAt = (tab && tab.startedAt) || now;
  if (tcf.locatorFound && !tcf.apiFound) {
    add('tcf.locator_without_api', 'warn', 'IAB TCF', 'Locator without window.__tcfapi', 'A __tcfapiLocator frame exists but window.__tcfapi is missing; only the postMessage API responds.');
  }
  if (tcf.apiFound && !tcf.locatorFound) {
    add('tcf.locator_missing', 'warn', 'IAB TCF', 'No __tcfapiLocator frame', 'window.__tcfapi exists but no __tcfapiLocator iframe was found — vendors in cross-origin iframes cannot reach the CMP (CMP API v2.2 requires the locator).');
  }
  if (tcf.cmpStatus === 'error') add('tcf.status_error', 'err', 'IAB TCF', 'CMP status error', 'CMP status is "error".');
  else if (tcf.apiFound && ping.cmpLoaded !== true && now - startedAt > NOT_LOADED_GRACE_MS) {
    add('tcf.not_loaded', 'warn', 'IAB TCF', 'CMP not loaded', '__tcfapi(\'ping\') still reports cmpLoaded: ' + String(ping.cmpLoaded) + ' (cmpStatus ' + (tcf.cmpStatus || 'unknown') + ') after ' + Math.round((now - startedAt) / 1000) + ' s — the stub was never replaced by the CMP.');
  }
  const missingCmd = TCF_REQUIRED_COMMANDS.filter((c) => tcf.commands[c] && tcf.commands[c].ok === false);
  if (missingCmd.length) add('tcf.required_command_missing', tcf.gdprApplies === false ? 'warn' : 'err', 'IAB TCF', 'Required command failed', 'Required CMP API command(s) did not respond correctly: ' + missingCmd.join(', ') + (tcf.gdprApplies === false ? ' (gdprApplies is false — the CMP may be idle, but the CMP API v2.2 requires these commands to respond regardless)' : '') + '.');
  if (tcf.errors.length) add('tcf.api_errors', 'warn', 'IAB TCF', '__tcfapi errors', tcf.errors.length + ' __tcfapi call(s) failed — see the IAB TCF tab.');

  if (tcf.cmpRegistered === false) {
    if (tcf.cmpDeleted) add('tcf.cmp_deleted', 'err', 'IAB TCF', 'CMP deleted from CMP list', 'CMP ' + tcf.cmpId + ' "' + (tcf.cmpEntry && tcf.cmpEntry.name) + '" was deleted from the IAB Global CMP List on ' + String(tcf.cmpEntry.deletedDate).slice(0, 10) + ' — its TC strings must be considered invalid.');
    else add('tcf.cmp_unregistered', 'err', 'IAB TCF', 'CMP not registered', 'CMP ID ' + tcf.cmpId + ' is not on the IAB Global CMP List.');
  } else if (tcf.cmpRegistered == null && tcf.cmpId != null && tcf.cmpId < 2) {
    add('tcf.cmp_unregistered', 'err', 'IAB TCF', 'Invalid CMP ID', 'CMP ID ' + tcf.cmpId + ' is not a valid registered IAB CMP ID.');
  }

  const d = tcf.decoded;
  if (tcf.tcString && d) {
    if (d.error) add('tcf.decode_failed', 'err', 'TC string', 'TC string undecodable', 'TC string failed to decode: ' + d.error);
    else {
      if (d.version !== 2) add('tcf.version', 'err', 'TC string', 'Unsupported version', 'Unsupported TC string version ' + d.version + ' (expected 2).');
      if (!d.isServiceSpecific) add('tcf.not_service_specific', 'err', 'TC string', 'Not service-specific', 'IsServiceSpecific must be 1; global-scope TC strings are invalid since 1 September 2021.');
      if (!d.hasDisclosedVendorsSegment && tcf.gdprApplies !== false) add('tcf.missing_disclosed_vendors', 'err', 'TC string', 'No DisclosedVendors segment', 'TC string has no DisclosedVendors segment — mandatory since TCF v2.3 (enforced 1 March 2026); strings without it are invalid.', URLS.TCF_SPEC, 'TC string specification');
      if (d.segmentErrors && d.segmentErrors.length) add('tcf.segment_decode_failed', 'warn', 'TC string', 'Segment undecodable', d.segmentErrors.join('; '));
      const age = now - d.lastUpdatedMs;
      if (age > TCF_MAX_AGE_MS) add('tcf.expired_13m', 'warn', 'TC string', 'Older than 13 months', 'TC string lastUpdated is older than 13 months (' + d.lastUpdated.slice(0, 10) + ') — TCF Policies require reminding users of their choices at least every 13 months.');
      if (d.createdMs > now + 24 * 3600 * 1000) add('tcf.created_future', 'warn', 'TC string', 'Created in the future', 'TC string "created" timestamp is in the future (' + d.created + ').');
      const latestPolicy = gvl && gvl.tcfPolicyVersion ? gvl.tcfPolicyVersion : TCF_CURRENT_POLICY_VERSION;
      if (d.tcfPolicyVersion !== latestPolicy) add('tcf.policy_version', 'warn', 'TC string', 'Policy version differs', 'TC string tcfPolicyVersion ' + d.tcfPolicyVersion + ' differs from the latest GVL policy version ' + latestPolicy + ' — transparency and consent must be re-established.');
      if (tcf.tcfPolicyVersion != null && tcf.tcfPolicyVersion !== d.tcfPolicyVersion) add('tcf.policy_version_api', 'info', 'TC string', 'API policy version ≠ string', 'The CMP API reports tcfPolicyVersion ' + tcf.tcfPolicyVersion + ' while the TC string encodes ' + d.tcfPolicyVersion + '.');
      if (tcf.gvlVersionMismatch) add('tcf.gvl_version_mismatch', 'info', 'TC string', 'GVL version ≠ ping', 'ping.gvlVersion is ' + tcf.gvlVersion + ' while the TC string was created with GVL v' + d.vendorListVersion + '.');
      if (d.publisherRestrictions.some((r) => r.restrictionType === 3)) add('tcf.restriction_type_undefined', 'warn', 'TC string', 'Undefined restriction type', 'A publisher restriction uses restrictionType 3, which is undefined by the specification.');
      const diffs = apiVsStringDifferences(tcf.tcData, d);
      if (diffs.length) add('tcf.api_string_mismatch', 'warn', 'TC string', 'API ≠ TC string', 'The TCData objects returned by the API differ from the encoded TC string for: ' + diffs.join(', ') + '.');
      for (const n of Object.keys(CHECK_TEXTS)) {
        const id = 'technicalComplianceCheck_' + n;
        if (tcf.technical.results[id] === false) add('tcf.technical_failed', (n === '4' && tcf.gdprApplies === false) ? 'warn' : 'err', 'TCF technical check', 'Check #' + n + ' failed', CHECK_TEXTS[n] + ' — ' + (tcf.technical.details[id] || 'failed'));
      }
    }
  } else if (tcf.gdprApplies === true && !tcf.tcString && (tcf.eventStatus === 'tcloaded' || tcf.eventStatus === 'useractioncomplete')) {
    add('tcf.no_tcstring_gdpr', 'warn', 'TC string', 'No TC string', 'GDPR applies and eventStatus is ' + tcf.eventStatus + ' but the CMP returned no TC string.');
  }
  if (!(tcf.tcString && d && !d.error) && tcf.technical.results.technicalComplianceCheck_4 === false) add('tcf.technical_failed', tcf.gdprApplies === false ? 'warn' : 'err', 'TCF technical check', 'Check #4 failed', CHECK_TEXTS[4] + ' — ' + tcf.technical.details.technicalComplianceCheck_4);

  if (tcf.storage && tcf.tcData) {
    const s = tcf.storage;
    if (s.IABTCF_TCString != null && tcf.tcString && s.IABTCF_TCString !== tcf.tcString) add('tcf.storage_mismatch', 'warn', 'IAB TCF', 'localStorage ≠ API', 'localStorage IABTCF_TCString differs from the TC string returned by the API.');
    if (s.IABTCF_AddtlConsent != null && tcf.tcData.addtlConsent && s.IABTCF_AddtlConsent !== tcf.tcData.addtlConsent) add('tcf.storage_mismatch', 'warn', 'IAB TCF', 'localStorage ≠ API', 'localStorage IABTCF_AddtlConsent differs from the API addtlConsent.');
  }

  const ac = tcf.ac;
  if (ac && !ac.valid) add('tcf.ac_invalid', 'warn', 'Additional Consent', 'AC string invalid', 'addtlConsent string has an unrecognized format: ' + ac.raw.slice(0, 40));
  if (ac && ac.valid && ac.version === 1) add('tcf.ac_v1', 'info', 'Additional Consent', 'AC v1', 'Additional Consent v2 has been the standard since December 2023; v1 strings cannot indicate whether transparency was established for an ATP.');
  if (ac && ac.valid && ac.duplicates.length) add('tcf.ac_duplicate_ids', 'info', 'Additional Consent', 'AC duplicate ids', 'ATP ids present in both the consented and disclosed parts: ' + ac.duplicates.join(', ') + ' — vendors included in Part 3 should not be included in Part 5.');
  return out;
}

export function runGppChecks(tab) {
  const out = [];
  const g = (tab && tab.gpp) || {};
  if (!g.apiFound && !g.ping) return out;
  const ping = g.ping ? g.ping.data : null;
  if (ping) {
    if (ping.signalStatus && ping.signalStatus !== 'ready') out.push({ id: 'gpp.not_ready', sev: 'info', area: 'IAB GPP', tab: 'gpp', title: 'GPP not ready', msg: '__gpp ping reports signalStatus "' + ping.signalStatus + '" (cmpStatus ' + (ping.cmpStatus || '-') + ').' });
    const secs = Array.isArray(ping.applicableSections) ? ping.applicableSections : (ping.applicableSections != null ? [ping.applicableSections] : []);
    if (ping.cmpStatus === 'loaded' && (secs.length === 0 || secs.every((s) => s === -1 || s === 0))) out.push({ id: 'gpp.no_applicable_section', sev: 'info', area: 'IAB GPP', tab: 'gpp', title: 'No applicable GPP section', msg: 'The CMP reports no applicable GPP section for this visitor (applicableSections ' + JSON.stringify(ping.applicableSections) + ').' });
    if (ping.gppString) {
      const h = decodeGppHeader(ping.gppString);
      if (!h.valid) out.push({ id: 'gpp.header_invalid', sev: 'warn', area: 'IAB GPP', tab: 'gpp', title: 'GPP header undecodable', msg: 'GPP string header could not be decoded: ' + (h.error || 'unknown error') });
      else if (h.mismatch) out.push({ id: 'gpp.header_mismatch', sev: 'warn', area: 'IAB GPP', tab: 'gpp', title: 'GPP header ≠ segments', msg: 'GPP header lists ' + h.sectionIds.length + ' section id(s) (' + h.sectionIds.join(', ') + ') but the string carries ' + h.segmentCount + ' section segment(s).' });
      else if (secs.length && secs.some((s) => s > 0) && !secs.filter((s) => s > 0).every((s) => h.sectionIds.includes(s))) out.push({ id: 'gpp.header_mismatch', sev: 'warn', area: 'IAB GPP', tab: 'gpp', title: 'applicableSections ≠ header', msg: 'applicableSections ' + JSON.stringify(secs) + ' are not all present in the GPP header sections (' + h.sectionIds.join(', ') + ').' });
    }
  }
  if ((g.errors || []).length) out.push({ id: 'gpp.errors', sev: 'warn', area: 'IAB GPP', tab: 'gpp', title: '__gpp errors', msg: g.errors.length + ' __gpp call(s) failed — see the IAB GPP tab.' });
  return out;
}

/** All findings for a tab, sorted err → warn → info (stable within a level). */
export function collectFindings(tab, models, ctx = {}) {
  const list = [
    ...runGcmChecks(tab, models.gcm),
    ...runTcfChecks(tab, models.tcf, ctx),
    ...runGppChecks(tab),
    ...runUetChecks(tab, models.uet)
  ];
  return list.map((f, i) => ({ ...f, _i: i })).sort((a, b) => (SEV_RANK[a.sev] - SEV_RANK[b.sev]) || (a._i - b._i)).map(({ _i, ...f }) => f);
}

/** 'error' | 'warning' | 'pass' | 'none' (see DESIGN §13.7). */
export function badgeStatus(findings, models) {
  if (findings.some((f) => f.sev === 'err')) return 'error';
  if (findings.some((f) => f.sev === 'warn')) return 'warning';
  const gcm = models && models.gcm, tcf = models && models.tcf;
  const gcmOk = gcm && gcm.googleTagsSeen && (gcm.defaultCount > 0 || (gcm.icsFlags && gcm.icsFlags.usedDefault));
  const tcfOk = tcf && tcf.present && tcf.phase === 'loaded';
  if (gcmOk || tcfOk) return 'pass';
  return 'none';
}

export default { collectFindings, badgeStatus, runTcfChecks, runGppChecks };
