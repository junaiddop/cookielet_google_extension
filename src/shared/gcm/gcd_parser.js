/**
 * Google `gcs` / `gcd` / `tcfd` URL parameter decoders (ESM, pure).
 *
 * gcd (Consent Mode v2) is POSITIONAL, built by gtag.js as
 *   '1' + Σ signal∈[ad_storage, analytics_storage, ad_user_data, ad_personalization] (sepChar + letterChar)
 *       + flagsChar (+ two container-scoped-default chars in current builds)
 * over the web-safe alphabet B64 = 0-9 a-z A-Z - _ . Each 2-bit field uses
 * Au(): 1 = unset, 3 = granted, 2 = denied, 0 = other. Per signal:
 *   sepChar    = B64[delegation << 2 | Au(implicit)]        → digit 1/2/3 while no delegation
 *   letterChar = B64[Au(declare) << 4 | Au(default) << 2 | Au(update)]
 * With declare unset (16) the letters are the familiar l/m/n/p/q/r/t/u/v:
 *   l not set · m no default/update denied · n no default/update granted
 *   p default denied · q denied/denied · r default denied → update granted
 *   t default granted · u granted → update denied · v granted/granted
 * flagsChar = B64[gpc << 3 | consentModeActive << 2 | allowAdPersonalizationSignalsCode].
 * Effective state precedence inside gtag: update > default > declare > implicit;
 * an unset signal BEHAVES AS GRANTED.
 *
 * gcs = 'G1' + d(ad_storage) + d(analytics_storage): '1' granted, '0' denied/implicit-denied,
 * '-' unset or implicit-granted. gcs is only appended when Consent Mode is active or a signal
 * is not granted — its absence is NOT "denied".
 *
 * tcfd = '1' + B64[cmpId>>6&63] + B64[cmpId&63] + B64[tcfPolicyVersion] + B64[flags]
 *   flags: 1 DMA region · 2 gdprApplies · 4 gtag_enable_tcf_support · 8 enableAdvertiserConsentMode · 16 waitPeriodTimedOut
 */

export const B64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';

export const SIGNAL_ORDER = Object.freeze(['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization']);

/** UniConsent "Signal Breakdown" wording for the nine classic letters. */
export const LETTER_MAP = Object.freeze({
  l: { def: null, upd: null, label: 'Signal not set' },
  m: { def: null, upd: 'denied', label: 'Denied after update' },
  n: { def: null, upd: 'granted', label: 'Granted after update' },
  p: { def: 'denied', upd: null, label: 'Denied by default' },
  q: { def: 'denied', upd: 'denied', label: 'Denied by default and after update' },
  r: { def: 'denied', upd: 'granted', label: 'Denied by default, granted after update' },
  t: { def: 'granted', upd: null, label: 'Granted by default' },
  u: { def: 'granted', upd: 'denied', label: 'Granted by default, denied after update' },
  v: { def: 'granted', upd: 'granted', label: 'Granted by default and after update' }
});

/** Au() inverse: 2-bit field → 'granted' | 'denied' | null (unset) | 'invalid'. */
function au(v) {
  if (v === 3) return 'granted';
  if (v === 2) return 'denied';
  if (v === 1) return null;
  return 'invalid';
}

function stateWord(v) { return v === 'granted' ? 'granted' : v === 'denied' ? 'denied' : v == null ? 'not set' : String(v); }

/** Human label for one classic gcd letter (UniConsent wording). */
export function describeSignal(letter) {
  const m = letter && LETTER_MAP[letter];
  return m ? m.label : (letter ? 'Unknown letter "' + letter + '"' : 'Signal not set');
}

/** Label for a fully decoded signal (falls back to the classic wording when declare/implicit are unset). */
export function describeGcdSignal(sig) {
  if (!sig) return 'Missing';
  if (sig.known === false) return sig.label || 'Unknown';
  // classic wording whenever no 'declare' is involved (implicit boot defaults are shown separately)
  if (sig.declare == null && !sig.delegated && sig.letter && LETTER_MAP[sig.letter]) return LETTER_MAP[sig.letter].label;
  const parts = [];
  if (sig.implicit != null) parts.push('implicit ' + stateWord(sig.implicit));
  if (sig.declare != null) parts.push('declared ' + stateWord(sig.declare));
  if (sig.default != null) parts.push('default ' + stateWord(sig.default));
  if (sig.update != null) parts.push('update ' + stateWord(sig.update));
  return parts.length ? parts.join(' · ') : 'Signal not set';
}

/**
 * @returns {null | {raw, valid, signals, hasUpdate, anyGranted, active, gpc, adPersonalizationSignals, containerDefaults, unknownLetters:[], error?}}
 * signals[name] = {letter, sep, known, implicit, declare, default, update, effective, behaves, delegated, label}
 * `effective` follows gtag precedence (update > default > declare > implicit) and is null when unset;
 * `behaves` is 'granted'|'denied' — what tags actually do (unset behaves as granted).
 */
export function parseGcd(gcd) {
  if (!gcd || typeof gcd !== 'string') return null;
  const out = { raw: gcd, valid: false, signals: {}, unknownLetters: [], hasUpdate: false, anyGranted: false, active: null, gpc: null, adPersonalizationSignals: null, containerDefaults: null };
  if (!/^1/.test(gcd) || gcd.length < 9) { out.error = 'Unexpected gcd format'; }
  for (let i = 0; i < SIGNAL_ORDER.length; i++) {
    const name = SIGNAL_ORDER[i];
    const sep = gcd.charAt(1 + 2 * i);
    const letter = gcd.charAt(2 + 2 * i);
    if (!letter) { out.signals[name] = { letter: null, sep: null, known: false, implicit: null, declare: null, default: null, update: null, effective: null, behaves: null, delegated: false, label: 'Missing' }; continue; }
    const si = B64.indexOf(sep), li = B64.indexOf(letter);
    if (si < 0 || li < 0) {
      out.unknownLetters.push(letter);
      out.signals[name] = { letter, sep, known: false, implicit: null, declare: null, default: null, update: null, effective: null, behaves: null, delegated: false, label: 'Unknown letter "' + letter + '"' };
      continue;
    }
    const implicit = au(si & 3), delegated = (si >> 2) !== 0;
    const declare = au((li >> 4) & 3), def = au((li >> 2) & 3), upd = au(li & 3);
    const effective = upd != null ? upd : def != null ? def : declare != null ? declare : implicit;
    const sig = { letter, sep, known: true, implicit, declare, default: def, update: upd, effective, behaves: effective === 'denied' ? 'denied' : 'granted', delegated, label: '' };
    sig.label = describeGcdSignal(sig);
    out.signals[name] = sig;
    if (upd != null) out.hasUpdate = true;
    if (effective === 'granted') out.anyGranted = true;
  }
  const flags = gcd.charAt(9);
  if (flags) {
    const fi = B64.indexOf(flags);
    if (fi >= 0) { out.gpc = !!(fi & 8); out.active = !!(fi & 4); out.adPersonalizationSignals = fi & 3; }
  }
  if (gcd.length >= 12) {
    const a = B64.indexOf(gcd.charAt(10)), b = B64.indexOf(gcd.charAt(11));
    if (a >= 0 && b >= 0) {
      out.containerDefaults = { used: !!((b >> 2) & 1), ad_storage: au((a >> 4) & 3), analytics_storage: au((a >> 2) & 3), ad_user_data: au(a & 3), ad_personalization: au(b & 3) };
    }
  }
  out.valid = !out.error && out.unknownLetters.length === 0 && Object.values(out.signals).every((s) => s.known);
  return out;
}

/** Row-oriented variant: [{signal, letter, label, default, update, effective, behaves}]. */
export function parseGcdWithLabels(gcd) {
  const p = parseGcd(gcd);
  if (!p) return null;
  return SIGNAL_ORDER.map((signal) => ({ signal, ...p.signals[signal] }));
}

/**
 * @returns {null | {raw, valid, configured, ad_storage, analytics_storage}}
 * values: 'granted' | 'denied' | null (unset / implicit-granted → behaves granted). `configured=false` for "G1--".
 */
export function parseGcs(gcs) {
  if (!gcs || typeof gcs !== 'string') return null;
  const m = gcs.match(/^G1([01-])([01-])/);
  if (!m) return { raw: gcs, valid: false, configured: false, ad_storage: null, analytics_storage: null };
  const d = (c) => (c === '1' ? 'granted' : c === '0' ? 'denied' : null);
  return { raw: gcs, valid: true, configured: !(m[1] === '-' && m[2] === '-'), ad_storage: d(m[1]), analytics_storage: d(m[2]) };
}

/** @returns {null | {raw, valid, cmpId, tcfPolicyVersion, flags:{dma, gdprApplies, gtagTcfSupport, advertiserConsentMode, waitPeriodTimedOut}}} */
export function parseTcfd(tcfd) {
  if (!tcfd || typeof tcfd !== 'string') return null;
  if (!/^1/.test(tcfd) || tcfd.length < 5) return { raw: tcfd, valid: false, cmpId: null, tcfPolicyVersion: null, flags: null };
  const a = B64.indexOf(tcfd[1]), b = B64.indexOf(tcfd[2]), p = B64.indexOf(tcfd[3]), f = B64.indexOf(tcfd[4]);
  if ([a, b, p, f].some((x) => x < 0)) return { raw: tcfd, valid: false, cmpId: null, tcfPolicyVersion: null, flags: null };
  return {
    raw: tcfd, valid: true, cmpId: (a << 6) | b, tcfPolicyVersion: p,
    flags: { dma: !!(f & 1), gdprApplies: !!(f & 2), gtagTcfSupport: !!(f & 4), advertiserConsentMode: !!(f & 8), waitPeriodTimedOut: !!(f & 16) }
  };
}

export const GcdParser = { parseGcd, parseGcdWithLabels, parseGcs, parseTcfd, describeSignal, describeGcdSignal, LETTER_MAP, SIGNAL_ORDER, B64 };
export default GcdParser;
