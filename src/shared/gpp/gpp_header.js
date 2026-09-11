/**
 * IAB Global Privacy Platform — header section decoder (pure, ESM).
 *
 * A GPP string is `<header>~<section>~<section>…`. The header is base64url and
 * holds: type int(6) = 3, version int(6), then the applicable section IDs as a
 * Fibonacci-coded integer range: int(12) item count; per item 1 bit (0 = single,
 * 1 = range) followed by Fibonacci-coded offsets (first from 0, then from the
 * previous value; a range's end is an offset from its start).
 * Spec: github.com/InteractiveAdvertisingBureau/Global-Privacy-Platform (Core/Consent String Specification).
 */

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const GPP_SECTION_NAMES = Object.freeze({
  1: 'tcfeuv1 — EU TCF v1 (deprecated)',
  2: 'tcfeuv2 — EU TCF v2',
  3: 'header — GPP header',
  4: 'signal integrity — GPP signal integrity',
  5: 'tcfcav1 — Canada TCF',
  6: 'uspv1 — US Privacy (CCPA) v1',
  7: 'usnat — US National (MSPA)',
  8: 'usca — US California',
  9: 'usva — US Virginia',
  10: 'usco — US Colorado',
  11: 'usut — US Utah',
  12: 'usct — US Connecticut',
  13: 'usfl — US Florida',
  14: 'usmt — US Montana',
  15: 'usor — US Oregon',
  16: 'ustx — US Texas',
  17: 'usde — US Delaware',
  18: 'usia — US Iowa',
  19: 'usne — US Nebraska',
  20: 'usnh — US New Hampshire',
  21: 'usnj — US New Jersey',
  22: 'ustn — US Tennessee',
  23: 'usmn — US Minnesota',
  24: 'usmd — US Maryland',
  25: 'usin — US Indiana',
  26: 'usky — US Kentucky'
});

function toBits(str) {
  let bits = '';
  for (let i = 0; i < str.length; i++) {
    const idx = B64URL.indexOf(str[i]);
    if (idx < 0) throw new Error('Invalid base64url character "' + str[i] + '"');
    bits += ('000000' + idx.toString(2)).slice(-6);
  }
  return bits;
}

class Reader {
  constructor(bits) { this.bits = bits; this.pos = 0; }
  int(n) {
    if (this.pos + n > this.bits.length) throw new Error('GPP header truncated at bit ' + this.pos);
    const v = parseInt(this.bits.substr(this.pos, n), 2);
    this.pos += n;
    return v;
  }
  /** Fibonacci code: bits weighted F(2)=1, F(3)=2, F(4)=3, … terminated by "11". */
  fib() {
    let value = 0;
    let a = 1, b = 1; // F(1)=1, F(2)=1 → first weight is F(2)=1
    let prev = 0;
    for (let guard = 0; guard < 64; guard++) {
      const bit = this.int(1);
      if (bit === 1 && prev === 1) return value; // terminating "11": the second 1 is the terminator
      const weight = b;
      if (bit === 1) value += weight;
      const next = a + b; a = b; b = next;
      prev = bit;
    }
    throw new Error('Unterminated Fibonacci code');
  }
  fibRange() {
    const count = this.int(12);
    const ids = [];
    let last = 0;
    for (let i = 0; i < count; i++) {
      const isRange = this.int(1) === 1;
      const start = last + this.fib();
      if (isRange) {
        const end = start + this.fib();
        for (let v = start; v <= end && ids.length < 4096; v++) ids.push(v);
        last = end;
      } else {
        ids.push(start);
        last = start;
      }
    }
    return ids;
  }
}

/**
 * @param {string} gppString full GPP string or just its header segment
 * @returns {{valid:boolean, version:number|null, sectionIds:number[], sections:{id:number,name:string}[], segmentCount:number, mismatch:boolean, error?:string}}
 */
export function decodeGppHeader(gppString) {
  const out = { valid: false, version: null, sectionIds: [], sections: [], segmentCount: 0, mismatch: false };
  if (!gppString || typeof gppString !== 'string') { out.error = 'Empty GPP string'; return out; }
  const parts = gppString.trim().split('~');
  out.segmentCount = parts.length - 1;
  try {
    const r = new Reader(toBits(parts[0]));
    const type = r.int(6);
    if (type !== 3) { out.error = 'Header type is ' + type + ' (expected 3)'; return out; }
    out.version = r.int(6);
    if (out.version !== 1) out.note = 'Header version ' + out.version + ' (this decoder implements version 1)';
    out.sectionIds = r.fibRange();
    const sorted = out.sectionIds.every((id, i) => i === 0 || id > out.sectionIds[i - 1]);
    if (!sorted) out.note = (out.note ? out.note + '; ' : '') + 'section ids are not strictly increasing';
    out.sections = out.sectionIds.map((id) => ({ id, name: GPP_SECTION_NAMES[id] || 'unknown section ' + id }));
    out.mismatch = out.segmentCount > 0 && out.segmentCount !== out.sectionIds.length;
    out.valid = true;
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
}

export default { decodeGppHeader, GPP_SECTION_NAMES };
