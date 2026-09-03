/**
 * IAB TCF v2.x TC string decoder (pure, dependency-free, ESM).
 *
 * Bit-level implementation of the core segment plus the DisclosedVendors
 * (type 1), AllowedVendors (type 2) and PublisherTC (type 3) segments, per the
 * IAB "Transparency and Consent String with Global Vendor List Format" spec.
 * Verified field-by-field against @iabtcf/core (see test/unit/tc_decoder.test.js
 * and test/fixtures/data/tc_vectors.json).
 */

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MAX_IDS = 20000; // guard against hostile range sections

export const PURPOSE_NAMES = Object.freeze({
  1: 'Store and/or access information on a device',
  2: 'Use limited data to select advertising',
  3: 'Create profiles for personalised advertising',
  4: 'Use profiles to select personalised advertising',
  5: 'Create profiles to personalise content',
  6: 'Use profiles to select personalised content',
  7: 'Measure advertising performance',
  8: 'Measure content performance',
  9: 'Understand audiences through statistics or combinations of data from different sources',
  10: 'Develop and improve services',
  11: 'Use limited data to select content'
});

export const SPECIAL_FEATURE_NAMES = Object.freeze({
  1: 'Use precise geolocation data',
  2: 'Identify devices based on information actively requested'
});

export const SPECIAL_PURPOSE_NAMES = Object.freeze({
  1: 'Ensure security, prevent and detect fraud, and fix errors',
  2: 'Deliver and present advertising and content',
  3: 'Save and communicate privacy choices'
});

export const FEATURE_NAMES = Object.freeze({
  1: 'Match and combine data from other data sources',
  2: 'Link different devices',
  3: 'Identify devices based on information transmitted automatically'
});

/** RestrictionType is 2 bits: 3 is undefined by the spec and therefore invalid. */
export const RESTRICTION_TYPES = Object.freeze({
  0: 'Purpose flatly not allowed',
  1: 'Require consent',
  2: 'Require legitimate interest',
  3: 'Undefined (invalid)'
});

/** Purposes that may never be processed under legitimate interest (TCF policy). */
export const LI_FORBIDDEN_PURPOSES = Object.freeze([1, 3, 4, 5, 6]);

/** TCF v2.2: a TC string older than 13 months must be treated as expired. */
export const MAX_AGE_MS = 396 * 24 * 60 * 60 * 1000;

/** Type 2 (AllowedVendors / out-of-band) was removed with global scope in 2021; decoded tolerantly for old strings. */
export const SEGMENT_TYPES = Object.freeze({ 0: 'core', 1: 'disclosedVendors', 2: 'allowedVendors (legacy)', 3: 'publisherTC' });

function toBits(str) {
  let bits = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    let idx = B64URL.indexOf(ch);
    if (idx < 0) {
      // tolerate standard base64 padding / alphabet from sloppy encoders
      if (ch === '=') continue;
      if (ch === '+') idx = 62;
      else if (ch === '/') idx = 63;
      else throw new Error('Invalid base64url character "' + ch + '" at position ' + i);
    }
    bits += ('000000' + idx.toString(2)).slice(-6);
  }
  return bits;
}

class Reader {
  constructor(bits) { this.bits = bits; this.pos = 0; }
  int(n) {
    if (this.pos + n > this.bits.length) throw new Error('TC string truncated at bit ' + this.pos);
    const v = parseInt(this.bits.substr(this.pos, n), 2); // n <= 36 → exact in a double
    this.pos += n;
    return v;
  }
  bool() { return this.int(1) === 1; }
  dateMs() { return this.int(36) * 100; } // deciseconds since epoch
  letters(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(65 + this.int(6));
    return s;
  }
  bitfieldSet(n) {
    const set = [];
    for (let i = 0; i < n; i++) if (this.int(1) === 1) set.push(i + 1);
    return set;
  }
  rangeSection() {
    const set = [];
    const numEntries = this.int(12);
    for (let i = 0; i < numEntries; i++) {
      const isRange = this.bool();
      const start = this.int(16);
      const end = isRange ? this.int(16) : start;
      for (let v = start; v <= end && set.length < MAX_IDS; v++) set.push(v);
    }
    return set;
  }
  vendorSection() {
    const maxId = this.int(16);
    const isRange = this.bool();
    return { maxId, set: isRange ? this.rangeSection() : this.bitfieldSet(maxId) };
  }
}

function decodeCore(bits) {
  const r = new Reader(bits);
  const d = {};
  d.version = r.int(6);
  d.createdMs = r.dateMs();
  d.lastUpdatedMs = r.dateMs();
  d.created = new Date(d.createdMs).toISOString();
  d.lastUpdated = new Date(d.lastUpdatedMs).toISOString();
  d.cmpId = r.int(12);
  d.cmpVersion = r.int(12);
  d.consentScreen = r.int(6);
  d.consentLanguage = r.letters(2);
  d.vendorListVersion = r.int(12);
  d.tcfPolicyVersion = r.int(6);
  d.isServiceSpecific = r.bool();
  d.useNonStandardTexts = r.bool();
  d.specialFeatureOptIns = r.bitfieldSet(12);
  d.purposeConsents = r.bitfieldSet(24);
  d.purposeLegitimateInterests = r.bitfieldSet(24);
  d.purposeOneTreatment = r.bool();
  d.publisherCC = r.letters(2);
  const vc = r.vendorSection();
  d.vendorConsents = vc.set;
  d.maxVendorIdConsent = vc.maxId;
  const vli = r.vendorSection();
  d.vendorLegitimateInterests = vli.set;
  d.maxVendorIdLI = vli.maxId;
  const numRestrictions = r.int(12);
  d.publisherRestrictions = [];
  for (let i = 0; i < numRestrictions; i++) {
    d.publisherRestrictions.push({
      purposeId: r.int(6),
      restrictionType: r.int(2), // 0 not allowed, 1 require consent, 2 require LI
      vendors: r.rangeSection()
    });
  }
  return d;
}

/** Segment type of a non-core segment string = its first 3 bits (first char >> 3). */
export function segmentTypeOf(segment) {
  if (!segment) return null;
  const idx = B64URL.indexOf(segment[0]);
  return idx < 0 ? null : (idx >> 3);
}

function decodeSegment(seg, out) {
  const r = new Reader(toBits(seg));
  const type = r.int(3);
  if (type === 1) {
    out.disclosedVendors = r.vendorSection().set;
    out.hasDisclosedVendorsSegment = true;
  } else if (type === 2) {
    out.allowedVendors = r.vendorSection().set;
  } else if (type === 3) {
    const pub = {
      purposeConsents: r.bitfieldSet(24),
      purposeLegitimateInterests: r.bitfieldSet(24)
    };
    const numCustom = r.int(6);
    pub.numCustomPurposes = numCustom;
    pub.customPurposeConsents = r.bitfieldSet(numCustom);
    pub.customPurposeLegitimateInterests = r.bitfieldSet(numCustom);
    out.publisherTC = pub;
  } else {
    (out.unknownSegmentTypes = out.unknownSegmentTypes || []).push(type);
  }
  return type;
}

/**
 * Decode a TC string. Never throws: returns `{error}` on a malformed core
 * segment; malformed trailing segments are reported in `segmentErrors` while the
 * rest of the decode is kept.
 */
export function decode(tcString) {
  if (!tcString || typeof tcString !== 'string') return { error: 'Empty TC string' };
  const raw = tcString.trim();
  try {
    const segs = raw.split('.');
    const d = decodeCore(toBits(segs[0]));
    d.raw = raw;
    d.byteSize = utf8Length(raw);
    d.hasDisclosedVendorsSegment = false;
    d.segments = [{ type: 0, name: 'core', raw: segs[0], length: segs[0].length }];
    d.segmentErrors = [];
    for (let i = 1; i < segs.length; i++) {
      const declared = segmentTypeOf(segs[i]);
      try {
        const type = decodeSegment(segs[i], d);
        d.segments.push({ type, name: SEGMENT_TYPES[type] || 'unknown', raw: segs[i], length: segs[i].length });
      } catch (e) {
        d.segments.push({ type: declared, name: SEGMENT_TYPES[declared] || 'unknown', raw: segs[i], length: segs[i].length, error: String(e && e.message || e) });
        d.segmentErrors.push('segment ' + i + ' (type ' + declared + '): ' + String(e && e.message || e));
      }
    }
    return d;
  } catch (e) {
    return { error: String((e && e.message) || e), raw };
  }
}

export function utf8Length(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c <= 0xdbff) ? (i++, 4) : 3;
  }
  return n;
}

/** True when both timestamps are rounded to the day in UTC (TCF v2.2 requirement). */
export function isDayPrecision(ms) {
  const d = new Date(ms);
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

export const TCDecoder = { decode, segmentTypeOf, utf8Length, isDayPrecision, PURPOSE_NAMES, SPECIAL_FEATURE_NAMES, SPECIAL_PURPOSE_NAMES, FEATURE_NAMES, RESTRICTION_TYPES, LI_FORBIDDEN_PURPOSES, MAX_AGE_MS, SEGMENT_TYPES };
export default TCDecoder;
