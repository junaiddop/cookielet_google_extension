import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddtlConsent } from '../../src/shared/tcf/ac_parser.js';
import { parseGcd, parseGcs, parseGcdWithLabels, describeSignal, LETTER_MAP } from '../../src/shared/gcm/gcd_parser.js';
import { toCsv } from '../../src/shared/util/csv.js';

test('AC v2 first visit / accept all / custom', () => {
  assert.deepEqual(parseAddtlConsent('2~~dv.70.311.1126'), { raw: '2~~dv.70.311.1126', valid: true, version: 2, consented: [], disclosed: [70, 311, 1126], duplicates: [] });
  assert.deepEqual(parseAddtlConsent('2~70.311~dv').consented, [70, 311], 'dot after dv optional when disclosed part is empty');
  assert.equal(parseAddtlConsent('2~70.311~dv').valid, true);
  assert.equal(parseAddtlConsent('2~70~dv311').valid, false);
  assert.deepEqual(parseAddtlConsent('2~70.311.1126~dv.').consented, [70, 311, 1126]);
  const c = parseAddtlConsent('2~70~dv.311.1126');
  assert.deepEqual([c.consented, c.disclosed], [[70], [311, 1126]]);
});

test('AC v1 and invalid', () => {
  assert.deepEqual(parseAddtlConsent('1~70.311').consented, [70, 311]);
  assert.equal(parseAddtlConsent('1~70.311').version, 1);
  assert.equal(parseAddtlConsent('garbage').valid, false);
  assert.equal(parseAddtlConsent(''), null);
  assert.equal(parseAddtlConsent(undefined), null);
  const dup = parseAddtlConsent('2~70~dv.70');
  assert.equal(dup.valid, true);
  assert.deepEqual(dup.duplicates, [70]);
});

test('gcd letter grid', () => {
  const p = parseGcd('13r3r3r3r5');
  assert.equal(p.valid, true);
  assert.deepEqual(Object.values(p.signals).map((s) => s.letter), ['r', 'r', 'r', 'r']);
  assert.equal(p.signals.ad_storage.default, 'denied');
  assert.equal(p.signals.ad_storage.update, 'granted');
  assert.equal(p.signals.ad_storage.effective, 'granted');
  assert.equal(p.hasUpdate, true);
  assert.equal(p.anyGranted, true);
  const q = parseGcd('13p3p3p3p5');
  assert.equal(q.hasUpdate, false);
  assert.equal(q.anyGranted, false);
  const l = parseGcd('11l1l1l1l1');
  assert.equal(l.signals.ad_user_data.known, true);
  assert.equal(l.signals.ad_user_data.effective, null);
  assert.equal(l.signals.ad_user_data.label, 'Signal not set');
  const short = parseGcd('13r3r5');
  assert.equal(short.valid, false);
  assert.equal(short.signals.ad_user_data.label, 'Missing');
  assert.deepEqual(parseGcd('13!3r3r3r5').unknownLetters, ['!']);
  assert.equal(parseGcd('13z3r3r3r5').signals.ad_storage.declare, 'denied', 'z is a declare-set letter, not unknown');
  assert.equal(parseGcd(''), null);
});

test('describeSignal covers the nine letters with UniConsent wording', () => {
  assert.equal(describeSignal('u'), 'Granted by default, denied after update');
  assert.equal(describeSignal('r'), 'Denied by default, granted after update');
  assert.equal(describeSignal('v'), 'Granted by default and after update');
  assert.equal(describeSignal('q'), 'Denied by default and after update');
  assert.equal(describeSignal('t'), 'Granted by default');
  assert.equal(describeSignal('p'), 'Denied by default');
  assert.equal(describeSignal('n'), 'Granted after update');
  assert.equal(describeSignal('m'), 'Denied after update');
  assert.equal(describeSignal('l'), 'Signal not set');
  assert.equal(Object.keys(LETTER_MAP).length, 9);
  const rows = parseGcdWithLabels('13t3u3v3q5');
  assert.deepEqual(rows.map((r) => r.signal), ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization']);
  assert.equal(rows[1].label, 'Granted by default, denied after update');
});

test('gcs', () => {
  assert.deepEqual(parseGcs('G100'), { raw: 'G100', valid: true, configured: true, ad_storage: 'denied', analytics_storage: 'denied' });
  assert.equal(parseGcs('G111').ad_storage, 'granted');
  assert.equal(parseGcs('G101').analytics_storage, 'granted');
  assert.equal(parseGcs('G1--').configured, false);
  assert.equal(parseGcs('G1--').valid, true);
  assert.equal(parseGcs('X').valid, false);
  assert.equal(parseGcs(null), null);
});

test('csv quoting', () => {
  const out = toCsv([['Id', 'Name', 'Result'], [1, 'a, "b"', 'Passed'], ['', 'line\nbreak', null]], { bom: false });
  assert.equal(out, 'Id,Name,Result\r\n1,"a, ""b""",Passed\r\n,"line\nbreak",\r\n');
  assert.ok(toCsv([['x']]).startsWith('﻿'));
});
