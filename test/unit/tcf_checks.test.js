import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../../src/shared/tcf/tc_decoder.js';
import { trimGvl, trimCmpList, deletedVendorIds, vendorName, cmpStatus, parseCsv, parseAtpCsv } from '../../src/shared/tcf/gvl.js';
import { runTechnicalChecks, TECHNICAL_CHECK_IDS, resultLabel } from '../../src/shared/tcf/technical_checks.js';
import { getSections, summarize, checkResult, flattenCmpApi } from '../../src/shared/tcf/policy_checks.js';
import { decodeGppHeader } from '../../src/shared/gpp/gpp_header.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const gvl = read('../fixtures/data/gvl_subset.json');
const cmpList = read('../fixtures/data/cmp_list_subset.json');
const { vectors } = read('../fixtures/data/tc_vectors.json');
const checksData = read('../../src/data/tcf_checks.json');
const vec = (name) => vectors.find((v) => v.name === name);

const okCommands = { ping: { ok: true }, addEventListener: { ok: true }, removeEventListener: { ok: true } };
const tabWith = (commands) => ({ tcf: { commands } });

test('trimGvl / trimCmpList shapes', () => {
  const raw = { gvlSpecificationVersion: 3, vendorListVersion: 5, tcfPolicyVersion: 5, lastUpdated: 'x', purposes: { 1: { id: 1, name: 'P1', description: 'long' } },
    specialPurposes: {}, features: {}, specialFeatures: { 1: { id: 1, name: 'SF1' } }, vendors: { 7: { id: 7, name: 'V7', purposes: [1], legIntPurposes: [], flexiblePurposes: [], specialPurposes: [], features: [], specialFeatures: [], urls: [{ privacy: 'x' }] }, 9: { id: 9, name: 'V9', deletedDate: '2025-01-01', purposes: [1] } } };
  const t = trimGvl(raw);
  assert.equal(t.maxVendorId, 9);
  assert.deepEqual(t.purposes[1], { id: 1, name: 'P1' });
  assert.equal(t.vendors[7].urls, undefined);
  assert.equal(t.vendors[9].deletedDate, '2025-01-01');
  assert.deepEqual(t.vendors[9].legIntPurposes, []);
  assert.deepEqual(deletedVendorIds(t), [1, 2, 3, 4, 5, 6, 8, 9]);
  assert.equal(vendorName(t, 7), 'V7');
  const c = trimCmpList({ lastUpdated: 'y', cmps: { 503: { id: 503, name: 'cookielet', isCommercial: true, environments: ['Web'] } } });
  assert.deepEqual(c.cmps[503], { id: 503, name: 'cookielet', isCommercial: true, environments: ['Web'] });
  const del = trimCmpList({ cmps: { 9: { id: 9, name: 'Gone', deletedDate: '2024-01-01T00:00:00Z' }, 8: { id: 8, name: 'Soon', deletedDate: '2999-01-01T00:00:00Z' } } });
  assert.equal(cmpStatus(del, 9).deleted, true);
  assert.equal(cmpStatus(del, 8).registered, true, 'future deletedDate still valid');
  assert.equal(cmpStatus(del, 7).registered, false);
  assert.throws(() => trimGvl({}));
});

test('technical checks: a compliant three-segment string passes 4–13 (except deleted/unknown vendor rule)', () => {
  const d = decode(vec('cookielet_style_three_segments').tcString);
  // vendorListVersion 174 vs fixture latest 174; GVL subset lacks most ids so #12 will flag consented ids missing from the subset.
  const { results, details } = runTechnicalChecks({ tab: tabWith(okCommands), decoded: d, ping: { cmpId: 503 }, cmpList, gvlLatest: gvl });
  assert.deepEqual(Object.keys(results), TECHNICAL_CHECK_IDS);
  assert.equal(results.technicalComplianceCheck_4, true);
  assert.equal(results.technicalComplianceCheck_5, true, details.technicalComplianceCheck_5);
  assert.equal(results.technicalComplianceCheck_6, true, details.technicalComplianceCheck_6);
  assert.equal(results.technicalComplianceCheck_7, true, details.technicalComplianceCheck_7);
  assert.equal(results.technicalComplianceCheck_8, true, details.technicalComplianceCheck_8);
  assert.equal(results.technicalComplianceCheck_9, true);
  assert.equal(results.technicalComplianceCheck_10, true);
  assert.equal(results.technicalComplianceCheck_11, true, details.technicalComplianceCheck_11);
  assert.equal(results.technicalComplianceCheck_13, true);
  assert.match(details.technicalComplianceCheck_5, /cookielet/);
});

test('technical checks: failures are detected', () => {
  const li = decode(vec('li_on_forbidden_purposes').tcString);
  assert.equal(runTechnicalChecks({ decoded: li }).results.technicalComplianceCheck_9, false);

  const bad = decode(vec('imprecise_timestamps_bad').tcString);
  const r = runTechnicalChecks({ decoded: bad }).results;
  assert.equal(r.technicalComplianceCheck_10, false);
  assert.equal(r.technicalComplianceCheck_11, false);

  const noDisclosed = decode(vec('service_specific_restriction').tcString);
  assert.equal(runTechnicalChecks({ decoded: noDisclosed }).results.technicalComplianceCheck_13, false);

  // unregistered CMP, deleted CMP
  const r5 = runTechnicalChecks({ decoded: noDisclosed, ping: { cmpId: 504 }, cmpList }).results.technicalComplianceCheck_5;
  assert.equal(r5, false);
  const deletedList = { cmps: { 503: { id: 503, name: 'x', deletedDate: '2024-01-01T00:00:00Z' } } };
  const r5d = runTechnicalChecks({ decoded: noDisclosed, ping: { cmpId: 503 }, cmpList: deletedList });
  assert.equal(r5d.results.technicalComplianceCheck_5, false);
  assert.match(r5d.details.technicalComplianceCheck_5, /deleted/);
  // no TC string: checks 6/7 fall back to ping.gvlVersion
  const viaPing = runTechnicalChecks({ ping: { gvlVersion: 173 }, gvlLatest: gvl }).results;
  assert.equal(viaPing.technicalComplianceCheck_6, true);
  assert.equal(viaPing.technicalComplianceCheck_7, true);
  assert.equal(runTechnicalChecks({ ping: { gvlVersion: 170 }, gvlLatest: gvl }).results.technicalComplianceCheck_7, false);

  // GVL version ahead of latest → #6 false; two behind → #7 false
  const old = { ...gvl, vendorListVersion: 172 };
  assert.equal(runTechnicalChecks({ decoded: noDisclosed, gvlLatest: old }).results.technicalComplianceCheck_6, false);
  const newer = { ...gvl, vendorListVersion: 176 };
  assert.equal(runTechnicalChecks({ decoded: noDisclosed, gvlLatest: newer }).results.technicalComplianceCheck_7, false);
  assert.equal(runTechnicalChecks({ decoded: noDisclosed, gvlLatest: { ...gvl, vendorListVersion: 175 } }).results.technicalComplianceCheck_7, true);

  // max vendor id above GVL → #8 false
  assert.equal(runTechnicalChecks({ decoded: noDisclosed, gvlLatest: { ...gvl, maxVendorId: 700 } }).results.technicalComplianceCheck_8, false);

  // deleted vendors: consent for a vendor with deletedDate (id 8 in the subset) → #12 false
  const g2 = { ...gvl, vendors: { ...gvl.vendors, 1: gvl.vendors[1] }, maxVendorId: 1638 };
  const withDeleted = { ...noDisclosed, vendorConsents: [1, 8], vendorLegitimateInterests: [] };
  const r12 = runTechnicalChecks({ decoded: withDeleted, gvlLatest: g2 });
  assert.equal(r12.results.technicalComplianceCheck_12, false);
  assert.match(r12.details.technicalComplianceCheck_12, /\b8\b/);
  // prefers the GVL matching the string's version
  const versioned = { ...g2, vendorListVersion: noDisclosed.vendorListVersion, vendors: { ...g2.vendors, 8: { ...g2.vendors[8], deletedDate: undefined } } };
  delete versioned.vendors[8].deletedDate;
  const r12b = runTechnicalChecks({ decoded: withDeleted, gvlLatest: g2, gvlForVersion: versioned });
  assert.equal(r12b.results.technicalComplianceCheck_12, true);

  // commands: missing → null; failed → false
  assert.equal(runTechnicalChecks({ tab: tabWith({ ping: { ok: true } }) }).results.technicalComplianceCheck_4, null);
  assert.equal(runTechnicalChecks({ tab: tabWith({ ...okCommands, removeEventListener: { ok: false } }) }).results.technicalComplianceCheck_4, false);
});

test('technical checks: gdprApplies=false → string checks not applicable', () => {
  const d = decode(vec('cookielet_style_three_segments').tcString);
  const { results, details } = runTechnicalChecks({ tab: tabWith(okCommands), decoded: d, ping: { cmpId: 503, gdprApplies: false }, cmpList, gvlLatest: gvl });
  assert.equal(results.technicalComplianceCheck_4, true);
  assert.equal(results.technicalComplianceCheck_5, true);
  for (let n = 6; n <= 13; n++) assert.equal(results['technicalComplianceCheck_' + n], null, 'check ' + n);
  assert.match(details.technicalComplianceCheck_13, /GDPR does not apply/);
  assert.equal(runTechnicalChecks({ decoded: d, gdprApplies: false, gvlLatest: gvl }).results.technicalComplianceCheck_6, null);
});

test('ATP provider list CSV parsing', () => {
  const csv = '\uFEFF"provider_id","provider_name","policy_url","domains"\r\n"70","Adobe Advertising Cloud","https://www.adobe.com/privacy/policy.html","adobe.com 2o7.net"\r\n"311","Company, Inc. ""The Best""","https://x.example/p","x.example"\n"bad","Nope","",""\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[2], ['311', 'Company, Inc. "The Best"', 'https://x.example/p', 'x.example']);
  const atp = parseAtpCsv(csv);
  assert.deepEqual(Object.keys(atp), ['70', '311']);
  assert.equal(atp[70].name, 'Adobe Advertising Cloud');
  assert.equal(atp[311].name, 'Company, Inc. "The Best"');
  assert.deepEqual(parseAtpCsv(''), {});
});

test('technical checks: missing inputs yield null, never throw', () => {
  const { results } = runTechnicalChecks({});
  for (const id of TECHNICAL_CHECK_IDS) assert.equal(results[id], null, id);
  const { results: r2 } = runTechnicalChecks({ decoded: { error: 'bad' } });
  assert.equal(r2.technicalComplianceCheck_6, null);
  assert.equal(r2.technicalComplianceCheck_9, null);
  assert.equal(resultLabel(null), 'Incomplete');
  assert.equal(resultLabel(true), 'Passed');
});

test('policy check catalogue + summaries', () => {
  const s = getSections(checksData);
  assert.equal(s.technical.length, 13);
  assert.equal(s.policy.length, 32);
  assert.equal(s.technical.filter((c) => c.automated).length, 10);
  assert.equal(s.policy.filter((c) => c.automated).length, 0);
  assert.equal(flattenCmpApi(s.cmpApi).length, 15);
  assert.equal(flattenCmpApi(s.cmpApi).find((c) => c.id === 'cmpTcfApiCheck_cmpApiPing_cmpLoaded').key, 'cmpLoaded');
  assert.ok(!/<[a-z]+>/i.test(s.policy[0].policyReference), 'HTML stripped');
  assert.match(s.technical[3].manualSteps, /ping, addEventListener, removeEventListener/);

  const automated = { technicalComplianceCheck_4: true, technicalComplianceCheck_5: false };
  const manual = { technicalComplianceCheck_1: true };
  const sum = summarize(s.technical, automated, manual);
  assert.deepEqual([sum.passed, sum.failed, sum.todo, sum.total], [2, 1, 10, 13]);
  assert.equal(sum.label, 'passed: 2 failed: 1 to do: 10');
  assert.equal(sum.status, 'Failed');
  assert.equal(summarize(s.policy, {}, {}).status, 'Incomplete');
  const all = {}; s.policy.forEach((c) => { all[c.id] = true; });
  assert.equal(summarize(s.policy, {}, all).status, 'Passed');
  assert.equal(checkResult(s.technical[0], automated, manual), true);
  assert.equal(checkResult(s.technical[4], automated, manual), false);
  assert.equal(checkResult(s.technical[5], automated, manual), null);
});

test('GPP header: spec examples and ranges', () => {
  assert.deepEqual(decodeGppHeader('DBABMA~CPXxRfAPXxRfAAfKABENB-CgAAAAAAAAAAYgAAAAAAAA').sectionIds, [2]);
  const two = decodeGppHeader('DBACNYA~CPXxRfAPXxRfAAfKABENB-CgAAAAAAAAAAYgAAAAAAAA~1YNN');
  assert.equal(two.valid, true);
  assert.equal(two.version, 1);
  assert.deepEqual(two.sectionIds, [2, 6]);
  assert.equal(two.segmentCount, 2);
  assert.equal(two.mismatch, false);
  assert.match(two.sections[1].name, /uspv1/);
  assert.equal(decodeGppHeader('DBACNYA').segmentCount, 0);
  assert.equal(decodeGppHeader('').valid, false);
  assert.equal(decodeGppHeader('CPXxRfA').valid, false);

  // encode [7..12] as a single range with our own Fibonacci encoder and decode it back
  const fibCode = (n) => { const f = [1]; for (let a = 1, b = 2; b <= n; [a, b] = [b, a + b]) f.push(b); let bits = ''; let rem = n; for (let i = f.length - 1; i >= 0; i--) { if (f[i] <= rem) { bits = '1' + bits; rem -= f[i]; } else bits = '0' + bits; } return bits + '1'; };
  assert.equal(fibCode(2), '011'); assert.equal(fibCode(7), '01011'); assert.equal(fibCode(1), '11');
  const bits = '000011' + '000001' + '000000000001' + '1' + fibCode(7) + fibCode(5);
  const padded = bits + '0'.repeat((6 - (bits.length % 6)) % 6);
  const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let header = '';
  for (let i = 0; i < padded.length; i += 6) header += B[parseInt(padded.slice(i, i + 6), 2)];
  assert.deepEqual(decodeGppHeader(header).sectionIds, [7, 8, 9, 10, 11, 12]);
});
