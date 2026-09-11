/**
 * Google Additional Consent (ATP) string parser.
 *
 *   v1: "1~<consented ids dot-separated>"
 *   v2: "2~<consented>~dv.<disclosed-but-not-consented>"   (each ATP in exactly one part)
 *
 * Examples: first visit "2~~dv.70.311.1126", accept-all "2~70.311.1126~dv." (the dot after "dv" is
 * optional only when the disclosed part is empty, so "2~70~dv" is accepted too), custom "2~70~dv.311.1126".
 * Google: "Vendors included in Part 3 should not be included in Part 5" → reported as duplicates.
 */

const V2 = /^2~([0-9.]*)~dv(?:\.([0-9.]*))?$/;
const V1 = /^1~([0-9.]*)$/;

function ids(s) {
  return s ? s.split('.').filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
}

/**
 * @returns {null | {raw, valid, version:1|2|null, consented:number[], disclosed:number[], duplicates:number[], error?:string}}
 */
export function parseAddtlConsent(ac) {
  if (ac == null || ac === '') return null;
  if (typeof ac !== 'string') return { raw: String(ac), valid: false, version: null, consented: [], disclosed: [], duplicates: [], error: 'not a string' };
  const raw = ac.trim();
  const out = { raw, valid: false, version: null, consented: [], disclosed: [], duplicates: [] };
  const m2 = raw.match(V2);
  const m1 = raw.match(V1);
  if (m2) {
    out.valid = true; out.version = 2;
    out.consented = ids(m2[1]); out.disclosed = ids(m2[2] || '');
    out.duplicates = out.consented.filter((id) => out.disclosed.includes(id));
  } else if (m1) {
    out.valid = true; out.version = 1;
    out.consented = ids(m1[1]);
  } else {
    out.error = 'Unrecognized Additional Consent format';
  }
  return out;
}

export default { parseAddtlConsent };
