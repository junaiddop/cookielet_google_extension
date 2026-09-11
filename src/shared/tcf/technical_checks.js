/**
 * IAB CMP Validator "Technical Compliance Checks" #4–#13, automated (pure, ESM).
 *
 * Mirrors the IAB Europe CMP Validator 2.3 logic (docs/reference-samples), with
 * two deliberate tightenings documented inline (#11 day precision, #12 GVL choice).
 * Every result is `true` (passed), `false` (failed) or `null` (could not be
 * evaluated yet — missing input); `details[id]` explains why.
 */
import { LI_FORBIDDEN_PURPOSES, isDayPrecision } from './tc_decoder.js';
import { deletedVendorIds, cmpStatus } from './gvl.js';
import { TCF_REQUIRED_COMMANDS } from '../constants.js';

export const TECHNICAL_CHECK_IDS = Object.freeze([4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => 'technicalComplianceCheck_' + n));

export function resultLabel(v) {
  if (v === true) return 'Passed';
  if (v === false) return 'Failed';
  return 'Incomplete';
}

/**
 * @param {object} p
 * @param {object} [p.tab]            tab record (uses tab.tcf.commands)
 * @param {object} [p.decoded]        output of tc_decoder.decode() (may carry .error)
 * @param {object} [p.tcData]         latest TCData from addEventListener
 * @param {object} [p.ping]           ping response
 * @param {object} [p.cmpList]        trimmed cmp-list
 * @param {object} [p.gvlLatest]      trimmed latest GVL
 * @param {object} [p.gvlForVersion]  trimmed GVL matching the TC string's vendorListVersion (optional)
 * @param {boolean} [p.gdprApplies]   from ping/tcData; when === false, string checks 6–13 are not applicable (null)
 */
export function runTechnicalChecks({ tab, decoded, tcData, ping, cmpList, gvlLatest, gvlForVersion, gdprApplies } = {}) {
  const results = {};
  const details = {};
  const d = decoded && !decoded.error ? decoded : null;
  const set = (n, value, detail) => { results['technicalComplianceCheck_' + n] = value; details['technicalComplianceCheck_' + n] = detail; };
  const gdprOff = gdprApplies === false || (gdprApplies == null && ping && ping.gdprApplies === false) || (gdprApplies == null && !ping && tcData && tcData.gdprApplies === false);

  // #4 required commands responded
  const commands = (tab && tab.tcf && tab.tcf.commands) || {};
  const missing = TCF_REQUIRED_COMMANDS.filter((c) => !commands[c]);
  if (missing.length) set(4, null, 'Not probed yet: ' + missing.join(', '));
  else {
    const failed = TCF_REQUIRED_COMMANDS.filter((c) => !commands[c].ok);
    set(4, failed.length === 0, failed.length ? 'No valid response from: ' + failed.join(', ') : 'ping, addEventListener and removeEventListener all responded');
  }

  // #5 CMP registered
  const cmpId = (ping && ping.cmpId) || (tcData && tcData.cmpId) || (d && d.cmpId) || null;
  if (!cmpList || !cmpList.cmps) set(5, null, 'CMP list not loaded');
  else if (!cmpId) set(5, null, 'No CMP id reported yet');
  else {
    const st = cmpStatus(cmpList, cmpId);
    if (!st.entry) set(5, false, 'CMP id ' + cmpId + ' is not on the IAB Global CMP List');
    else if (st.deleted) set(5, false, 'CMP ' + cmpId + ' "' + st.entry.name + '" was deleted from the Global CMP List on ' + String(st.entry.deletedDate).slice(0, 10) + ' — its TC strings are invalid');
    else set(5, true, 'CMP ' + cmpId + ' = ' + st.entry.name + (st.entry.isCommercial ? ' (commercial)' : ' (private)'));
  }

  if (gdprOff) {
    for (let n = 6; n <= 13; n++) set(n, null, 'GDPR does not apply on this page (gdprApplies=false) — TC string checks are not applicable');
    return { results, details };
  }

  // #6 GVL version format, #7 current or penultimate (TC string version, else ping.gvlVersion — IAB validator parity)
  const gvlVer = d ? d.vendorListVersion : (ping && typeof ping.gvlVersion === 'number' ? ping.gvlVersion : null);
  const gvlSrc = d ? 'TC string' : 'ping.gvlVersion';
  if (gvlVer == null) { set(6, null, 'No TC string and no gvlVersion in ping'); set(7, null, 'No TC string and no gvlVersion in ping'); }
  else if (!gvlLatest) { set(6, null, 'GVL not loaded'); set(7, null, 'GVL not loaded'); }
  else {
    const latest = gvlLatest.vendorListVersion;
    set(6, gvlVer > 0 && gvlVer <= latest, gvlSrc + ' GVL version ' + gvlVer + ', latest published ' + latest);
    set(7, gvlVer >= latest - 1, gvlVer >= latest - 1 ? 'GVL v' + gvlVer + ' is ' + (gvlVer === latest ? 'current' : 'penultimate') : 'GVL v' + gvlVer + ' is ' + (latest - gvlVer) + ' versions behind v' + latest);
  }
  // #8 max vendor id ≤ highest id in the latest GVL
  if (!d) set(8, null, 'No TC string');
  else if (!gvlLatest) set(8, null, 'GVL not loaded');
  else {
    const max = gvlLatest.maxVendorId;
    const ok = d.maxVendorIdConsent <= max && d.maxVendorIdLI <= max;
    set(8, ok, 'max vendor id consent ' + d.maxVendorIdConsent + ', LI ' + d.maxVendorIdLI + ', highest GVL id ' + max);
  }

  // #9 purposes 1,3,4,5,6 not under legitimate interest
  if (!d) set(9, null, 'No TC string');
  else {
    const bad = LI_FORBIDDEN_PURPOSES.filter((p) => d.purposeLegitimateInterests.includes(p));
    set(9, bad.length === 0, bad.length ? 'Legitimate interest signalled for purpose(s) ' + bad.join(', ') : 'No LI signal for purposes 1, 3, 4, 5, 6');
  }

  // #10 created == lastUpdated ; #11 timestamps rounded to the day
  if (!d) { set(10, null, 'No TC string'); set(11, null, 'No TC string'); }
  else {
    set(10, d.createdMs === d.lastUpdatedMs, d.createdMs === d.lastUpdatedMs ? 'Created and LastUpdated are identical' : 'Created ' + d.created + ' ≠ LastUpdated ' + d.lastUpdated);
    const dayPrecise = isDayPrecision(d.createdMs) && isDayPrecision(d.lastUpdatedMs);
    const secondsZero = new Date(d.createdMs).getUTCSeconds() === 0 && new Date(d.lastUpdatedMs).getUTCSeconds() === 0;
    // TCF v2.2 requires day precision; the IAB validator only checks seconds. We apply the spec.
    set(11, dayPrecise, dayPrecise ? 'Both timestamps are rounded to the day (UTC)'
      : (secondsZero ? 'Seconds are zero but hours/minutes are not (the IAB validator would pass this; TCF v2.2 requires day precision)' : 'Timestamps carry hours/minutes/seconds: ' + d.created + ' / ' + d.lastUpdated));
  }

  // #12 deleted vendors carry no signal (use the TC string's own GVL version when available)
  if (!d) set(12, null, 'No TC string');
  else {
    const g = (gvlForVersion && gvlForVersion.vendorListVersion === d.vendorListVersion) ? gvlForVersion : gvlLatest;
    if (!g) set(12, null, 'GVL not loaded');
    else {
      const deleted = new Set(deletedVendorIds(g));
      const bad = [...d.vendorConsents.filter((id) => deleted.has(id)), ...d.vendorLegitimateInterests.filter((id) => deleted.has(id))];
      const uniq = [...new Set(bad)].sort((a, b) => a - b);
      set(12, uniq.length === 0, uniq.length ? 'Signals set for deleted/unknown vendor id(s) ' + uniq.slice(0, 20).join(', ') + (uniq.length > 20 ? '…' : '') + ' (checked against GVL v' + g.vendorListVersion + ')' : 'No signals for deleted vendors (checked against GVL v' + g.vendorListVersion + ')');
    }
  }

  // #13 disclosedVendors segment present
  if (!d) set(13, null, 'No TC string');
  else set(13, !!d.hasDisclosedVendorsSegment, d.hasDisclosedVendorsSegment ? 'DisclosedVendors segment present (' + (d.disclosedVendors || []).length + ' vendors)' : 'TC string has segments [' + d.segments.map((s) => s.name).join(', ') + '] — no DisclosedVendors segment (mandatory since TCF v2.3, enforced 1 March 2026)');

  return { results, details };
}

export default { runTechnicalChecks, TECHNICAL_CHECK_IDS, resultLabel };
