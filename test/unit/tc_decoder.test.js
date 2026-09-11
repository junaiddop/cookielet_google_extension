import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode, segmentTypeOf, isDayPrecision, utf8Length } from '../../src/shared/tcf/tc_decoder.js';

const { vectors, oracle } = JSON.parse(readFileSync(new URL('../fixtures/data/tc_vectors.json', import.meta.url), 'utf8'));

const SCALARS = ['version', 'cmpId', 'cmpVersion', 'consentScreen', 'consentLanguage', 'vendorListVersion', 'tcfPolicyVersion',
  'isServiceSpecific', 'useNonStandardTexts', 'purposeOneTreatment', 'publisherCC', 'created', 'lastUpdated'];
const SETS = ['purposeConsents', 'purposeLegitimateInterests', 'specialFeatureOptIns', 'vendorConsents', 'vendorLegitimateInterests'];

for (const v of vectors) {
  test(`decodes vector "${v.name}" like ${oracle}`, () => {
    const d = decode(v.tcString);
    assert.equal(d.error, undefined, 'no decode error');
    for (const k of SCALARS) assert.deepEqual(d[k], v.expected[k], k);
    for (const k of SETS) assert.deepEqual(d[k], v.expected[k], k);
    assert.deepEqual(d.segments.map((s) => s.type), v.segmentTypes, 'segment types');
    assert.equal(d.hasDisclosedVendorsSegment, v.segmentTypes.includes(1));
    if (v.segmentTypes.includes(1)) assert.deepEqual(d.disclosedVendors, v.expected.disclosedVendors, 'disclosedVendors');
    else assert.equal(d.disclosedVendors, undefined);
    if (v.segmentTypes.includes(2)) assert.deepEqual(d.allowedVendors, v.expected.allowedVendors, 'allowedVendors');
    if (v.segmentTypes.includes(3)) {
      assert.deepEqual(d.publisherTC.purposeConsents, v.expected.publisherConsents, 'publisherConsents');
      assert.deepEqual(d.publisherTC.purposeLegitimateInterests, v.expected.publisherLegitimateInterests, 'publisherLI');
      assert.deepEqual(d.publisherTC.customPurposeConsents, v.expected.publisherCustomConsents, 'customConsents');
      assert.deepEqual(d.publisherTC.customPurposeLegitimateInterests, v.expected.publisherCustomLegitimateInterests, 'customLI');
    }
    assert.deepEqual(d.publisherRestrictions, v.expected.publisherRestrictions, 'publisherRestrictions');
    assert.equal(d.byteSize, v.tcString.length);
    assert.equal(d.createdMs, Date.parse(v.expected.created));
  });
}

test('range-encoded vendor sections expand correctly', () => {
  const v = vectors.find((x) => x.name === 'range_vendors_big');
  const d = decode(v.tcString);
  // The oracle keeps only vendors present in GVL v174 (ids 100..400 minus deleted / unknown ones),
  // so the sets are large and mostly contiguous — the encoder picks the range representation.
  assert.deepEqual(d.vendorConsents, v.expected.vendorConsents);
  assert.ok(d.vendorConsents.length >= 100);
  assert.equal(d.maxVendorIdConsent, Math.max(...v.expected.vendorConsents));
  assert.equal(d.maxVendorIdLI, Math.max(...v.expected.vendorLegitimateInterests));
});

test('segmentTypeOf reads the first three bits', () => {
  assert.equal(segmentTypeOf('IAAA'), 1);   // I = 8  → 001xxx
  assert.equal(segmentTypeOf('PAAA'), 1);   // P = 15 → 001111
  assert.equal(segmentTypeOf('QAAA'), 2);   // Q = 16 → 010000
  assert.equal(segmentTypeOf('YAAA'), 3);   // Y = 24 → 011000
  assert.equal(segmentTypeOf('eAAA'), 3);   // e = 30 → 011110
  assert.equal(segmentTypeOf('CAAA'), 0);
  assert.equal(segmentTypeOf(''), null);
});

test('malformed input never throws', () => {
  assert.ok(decode('').error);
  assert.ok(decode(null).error);
  assert.ok(decode('!!!').error);
  assert.ok(decode('CQ').error, 'truncated core');
  const d = decode(vectors[0].tcString + '.!!');
  assert.equal(d.error, undefined);
  assert.equal(d.segmentErrors.length, 1, 'bad trailing segment is reported, core kept');
});

test('tolerates standard base64 alphabet and padding', () => {
  const v = vectors.find((x) => x.name === 'core_only');
  const alt = v.tcString.replace(/-/g, '+').replace(/_/g, '/') + '==';
  assert.equal(decode(alt).cmpId, v.expected.cmpId);
});

test('day precision helper', () => {
  assert.equal(isDayPrecision(Date.UTC(2026, 7, 1)), true);
  assert.equal(isDayPrecision(Date.UTC(2026, 7, 1, 0, 0, 30)), false);
  assert.equal(isDayPrecision(Date.UTC(2026, 7, 1, 10, 15, 0)), false);
  const bad = decode(vectors.find((x) => x.name === 'imprecise_timestamps_bad').tcString);
  assert.equal(isDayPrecision(bad.createdMs), false);
  assert.notEqual(bad.createdMs, bad.lastUpdatedMs);
});

test('utf8Length', () => {
  assert.equal(utf8Length('abc'), 3);
  assert.equal(utf8Length('é'), 2);
  assert.equal(utf8Length('😀'), 4);
});
