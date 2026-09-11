/**
 * IAB TCF model — everything the TCF view, the findings and the report need
 * (pure, ESM). Combines: ping (polled), addEventListener TCData, the decoded
 * TC string, the IABTCF_* storage snapshot, the cmp-list, the GVL (latest + the
 * string's own version) and Google's ATP list.
 */
import { decode as decodeTc, PURPOSE_NAMES, SPECIAL_FEATURE_NAMES, LI_FORBIDDEN_PURPOSES } from './tc_decoder.js';
import { parseAddtlConsent } from './ac_parser.js';
import { runTechnicalChecks } from './technical_checks.js';
import { cmpStatus } from './gvl.js';

export function buildTcfModel(tab, { gvl = null, gvlForVersion = null, cmpList = null, atp = null } = {}) {
  const t = (tab && tab.tcf) || {};
  const m = {
    present: !!(t.apiFound || t.locatorFound || t.ping || t.data),
    apiFound: !!t.apiFound, locatorFound: !!t.locatorFound, viaPostMessage: !!t.viaPostMessage,
    ping: t.ping ? t.ping.data : null, pingAt: t.ping ? t.ping.timestamp : null, pingHistory: t.pingHistory || [],
    tcData: t.data ? t.data.data : null, tcDataAt: t.data ? t.data.timestamp : null, history: t.history || [],
    commands: t.commands || {}, errors: t.errors || [], storage: t.storage ? t.storage.data : null,
    tcString: null, decoded: null, gdprApplies: null, eventStatus: null, cmpStatus: null, displayStatus: null,
    cmpId: null, cmpVersion: null, cmpName: null, cmpRegistered: null, cmpIsCommercial: null, cmpDeleted: false, cmpEntry: null,
    apiVersion: null, tcfPolicyVersion: null, gvlVersion: null,
    phase: 'none', ac: null, counts: null, summaryLines: [], technical: { results: {}, details: {} }, apiRows: [], gvlVersionMismatch: false
  };
  if (!m.present) return m;

  const ping = m.ping || {};
  const td = m.tcData || {};
  m.tcString = typeof td.tcString === 'string' && td.tcString ? td.tcString : null;
  if (m.tcString) m.decoded = decodeTc(m.tcString);
  const d = m.decoded && !m.decoded.error ? m.decoded : null;

  m.gdprApplies = typeof ping.gdprApplies === 'boolean' ? ping.gdprApplies : (typeof td.gdprApplies === 'boolean' ? td.gdprApplies : null);
  m.eventStatus = td.eventStatus || null;
  m.cmpStatus = ping.cmpStatus || td.cmpStatus || null;
  m.displayStatus = ping.displayStatus || null;
  m.cmpId = ping.cmpId || td.cmpId || (d && d.cmpId) || null;
  m.cmpVersion = ping.cmpVersion != null ? ping.cmpVersion : (td.cmpVersion != null ? td.cmpVersion : (d ? d.cmpVersion : null));
  m.apiVersion = ping.apiVersion != null ? String(ping.apiVersion) : null;
  m.tcfPolicyVersion = ping.tcfPolicyVersion != null ? ping.tcfPolicyVersion : (td.tcfPolicyVersion != null ? td.tcfPolicyVersion : (d ? d.tcfPolicyVersion : null));
  m.gvlVersion = typeof ping.gvlVersion === 'number' ? ping.gvlVersion : null;
  m.gvlVersionMismatch = !!(d && m.gvlVersion != null && d.vendorListVersion !== m.gvlVersion);

  m.phase = m.cmpStatus === 'error' ? 'error' : m.cmpStatus === 'loaded' ? 'loaded' : m.cmpStatus === 'loading' ? 'loading' : (m.cmpStatus === 'stub' || (m.apiFound && !m.ping)) ? 'stub' : (m.locatorFound && !m.apiFound ? 'locator' : 'unknown');

  if (m.cmpId != null) {
    if (cmpList && cmpList.cmps) {
      const st = cmpStatus(cmpList, m.cmpId);
      m.cmpEntry = st.entry; m.cmpRegistered = st.registered; m.cmpDeleted = st.deleted;
      m.cmpName = st.entry ? st.entry.name : 'NOT FOUND';
      m.cmpIsCommercial = st.entry ? !!st.entry.isCommercial : null;
    } else {
      m.cmpName = m.cmpId >= 2 ? 'CMP #' + m.cmpId : 'invalid id ' + m.cmpId;
      m.cmpRegistered = null;
    }
  } else if (!m.ping && !m.tcData) {
    m.cmpName = 'CMP Loading…';
  }

  m.ac = parseAddtlConsent(td.addtlConsent);
  if (m.ac && atp) m.ac.names = {};
  if (m.ac && atp) for (const id of [...m.ac.consented, ...m.ac.disclosed]) m.ac.names[id] = atp[id] ? atp[id].name : null;

  if (d) {
    const gvlPurposeIds = gvl && gvl.purposes ? Object.keys(gvl.purposes).map(Number) : Object.keys(PURPOSE_NAMES).map(Number);
    const liEligible = gvlPurposeIds.filter((p) => !LI_FORBIDDEN_PURPOSES.includes(p));
    const objected = liEligible.filter((p) => !d.purposeLegitimateInterests.includes(p)).length;
    m.counts = {
      purposeConsents: d.purposeConsents.length, purposeLI: d.purposeLegitimateInterests.length, purposeLIObjected: objected,
      specialFeatures: d.specialFeatureOptIns.length, vendorConsents: d.vendorConsents.length, vendorLI: d.vendorLegitimateInterests.length,
      vendorsDisclosed: (d.disclosedVendors || []).length, purposeTotal: gvlPurposeIds.length, specialFeatureTotal: gvl && gvl.specialFeatures ? Object.keys(gvl.specialFeatures).length : Object.keys(SPECIAL_FEATURE_NAMES).length
    };
    const c = m.counts;
    m.summaryLines = [
      c.purposeConsents === 0 ? 'The user rejected consent for all purposes' : (c.purposeConsents >= c.purposeTotal ? 'The user has expressed consent for all purposes' : 'Number of purposes the user has expressed consent for: ' + c.purposeConsents),
      objected === 0 ? 'The user did not object to the use of legitimate interest for any purpose' : (objected >= liEligible.length ? 'The user objected to the use of legitimate interest for all purposes' : 'Number of purposes the user objected to the use of legitimate interest: ' + objected),
      c.specialFeatures === 0 ? 'The user rejected consent for any special features' : (c.specialFeatures >= c.specialFeatureTotal ? 'The user has expressed consent for all special features' : 'Number of special features the user has expressed consent for: ' + c.specialFeatures),
      'Number of vendors the user has expressed consent for: ' + c.vendorConsents,
      'Number of vendors the user agreed to the use of legitimate interest: ' + c.vendorLI,
      'Number of vendors disclosed to the user: ' + c.vendorsDisclosed
    ];
  }

  m.technical = runTechnicalChecks({ tab, decoded: m.decoded, tcData: m.tcData, ping: m.ping, cmpList, gvlLatest: gvl, gvlForVersion, gdprApplies: m.gdprApplies });

  const cmd = (name) => m.commands[name];
  const val = (c) => (c ? (c.ok ? 'true' : 'false') : 'not probed');
  m.apiRows = {
    cmpInformation: { cmpId: m.cmpId != null ? String(m.cmpId) : '-', cmpIsCommercial: m.cmpIsCommercial == null ? '-' : String(m.cmpIsCommercial) },
    cmpApi: {
      tcfVersion: m.apiVersion || (m.tcfPolicyVersion != null ? 'policy ' + m.tcfPolicyVersion : '-'),
      tcfApiFound: String(m.apiFound), tcfApiLocatorFound: String(m.locatorFound),
      pingResponse: val(cmd('ping')), getTCDataResponse: val(cmd('getTCData')), addEventListenerResponse: val(cmd('addEventListener')),
      removeEventListenerResponse: val(cmd('removeEventListener')), getInAppTCDataResponse: val(cmd('getInAppTCData')), getVendorListResponse: val(cmd('getVendorList'))
    },
    cmpApiPing: { cmpLoaded: ping.cmpLoaded != null ? String(ping.cmpLoaded) : '-', gdprApplies: ping.gdprApplies != null ? String(ping.gdprApplies) : '-', cmpStatus: ping.cmpStatus || '-', displayStatus: ping.displayStatus || '-' }
  };
  return m;
}

/** Compare the API TCData purpose/vendor maps with the decoded string (returns list of differences). */
export function apiVsStringDifferences(tcData, decoded) {
  const diffs = [];
  if (!tcData || !decoded || decoded.error) return diffs;
  const mapOn = (obj) => Object.keys(obj || {}).filter((k) => obj[k] === true).map(Number).sort((a, b) => a - b);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (tcData.purpose) {
    if (tcData.purpose.consents && !same(mapOn(tcData.purpose.consents), decoded.purposeConsents)) diffs.push('purpose consents');
    if (tcData.purpose.legitimateInterests && !same(mapOn(tcData.purpose.legitimateInterests), decoded.purposeLegitimateInterests)) diffs.push('purpose legitimate interests');
  }
  if (tcData.vendor) {
    if (tcData.vendor.consents && !same(mapOn(tcData.vendor.consents), decoded.vendorConsents)) diffs.push('vendor consents');
    if (tcData.vendor.legitimateInterests && !same(mapOn(tcData.vendor.legitimateInterests), decoded.vendorLegitimateInterests)) diffs.push('vendor legitimate interests');
  }
  if (tcData.specialFeatureOptins && !same(mapOn(tcData.specialFeatureOptins), decoded.specialFeatureOptIns)) diffs.push('special feature opt-ins');
  return diffs;
}

export default { buildTcfModel, apiVsStringDifferences };
