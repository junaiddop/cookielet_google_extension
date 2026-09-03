import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGcd, parseGcs, parseTcfd, describeGcdSignal } from '../../src/shared/gcm/gcd_parser.js';
import { buildGcmModel, effectiveState } from '../../src/shared/gcm/gcm_model.js';
import { runGcmChecks, gcmStatus } from '../../src/shared/gcm/gcm_checks.js';
import { buildUetModel, runUetChecks } from '../../src/shared/uet/uet_model.js';
import { buildTcfModel } from '../../src/shared/tcf/tcf_model.js';
import { collectFindings, badgeStatus } from '../../src/shared/checks/findings.js';
import { buildCsvRows, buildCsv } from '../../src/shared/report/export.js';
import { decode } from '../../src/shared/tcf/tc_decoder.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const { vectors } = read('../fixtures/data/tc_vectors.json');
const gvl = read('../fixtures/data/gvl_subset.json');
const cmpList = read('../fixtures/data/cmp_list_subset.json');
const checks = read('../../src/data/tcf_checks.json');
const T0 = 1_800_000_000_000;

function blankTab(over = {}) {
  return {
    v: 2, pageUrl: 'https://example.test/', startedAt: T0, diagnostics: null,
    gcm: { events: [], dl: [], ics: null, icsHistory: [] },
    tcf: { apiFound: false, locatorFound: false, ping: null, data: null, history: [], pingHistory: [], commands: {}, errors: [], storage: null },
    gpp: { apiFound: false, locatorFound: false, ping: null, events: [], data: null, errors: [] },
    uet: { apiFound: false, kind: null, config: null, events: [] },
    network: { signals: [], firstTagLoadAt: null, firstCollectAt: null },
    ...over
  };
}
const ev = (command, params, ts, extra = {}) => ({ data: { command, params, ...extra }, timestamp: ts });
const DEF = { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500, region: ['DE'] };

test('positional gcd decoding incl. flags and container defaults', () => {
  const p = parseGcd('13r3r3r3r5l1');
  assert.equal(p.valid, true);
  assert.equal(p.signals.ad_storage.implicit, 'granted');
  assert.equal(p.signals.ad_storage.default, 'denied');
  assert.equal(p.signals.ad_storage.update, 'granted');
  assert.equal(p.signals.ad_storage.effective, 'granted');
  assert.equal(p.signals.ad_storage.label, 'Denied by default, granted after update');
  assert.equal(p.active, true);
  assert.equal(p.gpc, false);
  assert.equal(p.adPersonalizationSignals, 1);
  assert.equal(p.containerDefaults.used, false);
  const q = parseGcd('13l3l3l3l1l1');
  assert.equal(q.signals.ad_user_data.effective, 'granted', 'unset → implicit granted');
  assert.equal(q.signals.ad_user_data.update, null);
  assert.equal(q.signals.ad_user_data.label, 'Signal not set');
  assert.equal(q.active, false);
  const gpc = parseGcd('13p3p3p3pdl1');
  assert.equal(gpc.gpc, true);
  assert.equal(gpc.active, true);
  // declare set → letter beyond the classic map still decodes
  const dec = parseGcd('13' + 'z' + '3r3r3r5l1'); // z = 35 → declare 2 (denied), default 0? compute: 35 = 0b100011 → declare=2, default=0, update=3
  assert.equal(dec.signals.ad_storage.declare, 'denied');
  assert.equal(dec.signals.ad_storage.update, 'granted');
  assert.match(describeGcdSignal(dec.signals.ad_storage), /declared denied/);
  assert.equal(parseGcd('xyz').valid, false);
  assert.equal(parseGcd(''), null);
});

test('gcs variants and tcfd', () => {
  assert.equal(parseGcs('G111').ad_storage, 'granted');
  assert.equal(parseGcs('G1-1').ad_storage, null);
  assert.equal(parseGcs('G1-1').analytics_storage, 'granted');
  assert.equal(parseGcs('G1--').configured, false);
  assert.equal(parseGcs('G100').configured, true);
  const t = parseTcfd('17T5' + '3'); // cmpId 7<<6 | 55 = 503, policy 5, flags 3 = dma+gdpr
  assert.equal(t.valid, true);
  assert.equal(t.cmpId, 503);
  assert.equal(t.tcfPolicyVersion, 5);
  assert.deepEqual(t.flags, { dma: true, gdprApplies: true, gtagTcfSupport: false, advertiserConsentMode: false, waitPeriodTimedOut: false });
  assert.equal(parseTcfd('x').valid, false);
});

test('gcm model: defaults/updates/regions/ics', () => {
  const tab = blankTab({
    gcm: {
      events: [ev('default', { ad_storage: 'denied', analytics_storage: 'granted' }, T0 + 10, { dlIndex: 0 }), ev('default', { ad_storage: 'granted', region: 'US' }, T0 + 11, { dlIndex: 1 }), ev('set', { ads_data_redaction: true }, T0 + 12), ev('update', { ad_storage: 'granted' }, T0 + 500, { dlIndex: 5 })],
      dl: [{ data: { kind: 'js', dlIndex: 2 }, timestamp: T0 + 12 }, { data: { kind: 'config', tagId: 'G-1', dlIndex: 3 }, timestamp: T0 + 13 }],
      ics: { data: { active: true, usedDefault: true, usedUpdate: true, wasSetLate: false, waitPeriodTimedOut: false, entries: { ad_storage: { default: false, update: true, implicit: true }, analytics_storage: { default: true } } }, timestamp: T0 + 600 }
    },
    diagnostics: { tagIds: [{ id: 'G-1', source: 'dataLayer' }], gtagLoaded: true, gtagData: true, gcmActive: true }
  });
  const m = buildGcmModel(tab);
  assert.equal(m.defaultCount, 2);
  assert.equal(m.defaults.ad_storage, 'denied', 'global default kept, region default separate');
  assert.deepEqual(m.regionDefaults.US, { ad_storage: 'granted' });
  assert.equal(m.updates.ad_storage, 'granted');
  assert.equal(m.setFlags.ads_data_redaction, true);
  assert.equal(m.dl.consentDefaultIndex, 0);
  assert.equal(m.dl.firstJsIndex, 2);
  assert.equal(m.dl.firstConfigIndex, 3);
  assert.equal(m.icsSignals.ad_storage.effective, 'granted');
  assert.equal(m.icsSignals.ad_storage.source, 'update');
  assert.equal(m.icsSignals.ad_user_data.effective, null);
  assert.equal(m.icsSignals.ad_user_data.behaves, 'granted');
  assert.equal(effectiveState(m, 'analytics_storage'), 'granted');
  assert.equal(m.googleTagsSeen, true);
  assert.equal(buildGcmModel(blankTab()).googleTagsSeen, false);
});

test('gcm checks: correct implementation → no errors, only best-practice info', () => {
  const tab = blankTab({
    gcm: { events: [ev('default', DEF, T0 + 10, { dlIndex: 0 }), ev('update', { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' }, T0 + 900, { dlIndex: 4 })],
      dl: [{ data: { kind: 'js', dlIndex: 1 }, timestamp: T0 + 11 }, { data: { kind: 'config', tagId: 'G-1', dlIndex: 2 }, timestamp: T0 + 12 }], ics: null, icsHistory: [] },
    network: { signals: [{ host: 'www.googletagmanager.com', path: '/gtag/js', type: 'tag_load', timestamp: T0 + 50 }, { host: 'www.google-analytics.com', path: '/g/collect', type: 'hit', gcs: 'G111', gcd: '13r3r3r3r5l1', timestamp: T0 + 1200 }], firstTagLoadAt: T0 + 50, firstCollectAt: T0 + 1200 }
  });
  const m = buildGcmModel(tab);
  const f = runGcmChecks(tab, m);
  assert.deepEqual(f.filter((x) => x.sev === 'err'), []);
  assert.deepEqual(f.filter((x) => x.sev === 'warn'), []);
  const ids = f.map((x) => x.id);
  assert.ok(ids.includes('gcm.ads_data_redaction'));
  assert.ok(!ids.includes('gcm.region'), 'region present');
  assert.ok(!ids.includes('gcm.wait_for_update'));
  assert.equal(gcmStatus(m, f).status, 'pass');
});

test('gcm checks: late default via dataLayer order and via ics.wasSetLate', () => {
  const tab = blankTab({ gcm: { events: [ev('default', DEF, T0 + 300, { dlIndex: 3 })], dl: [{ data: { kind: 'gtm.js', dlIndex: 0 }, timestamp: T0 + 5 }], ics: null, icsHistory: [] }, diagnostics: { gtmLoaded: true, tagIds: [{ id: 'GTM-X' }] } });
  const f = runGcmChecks(tab, buildGcmModel(tab));
  const late = f.find((x) => x.id === 'gcm.default_after_tag_load');
  assert.ok(late && late.sev === 'err');
  assert.match(late.msg, /gtm\.js/);

  const tab2 = blankTab({ gcm: { events: [ev('default', DEF, T0 + 300, { dlIndex: 0 })], dl: [], ics: { data: { active: true, usedDefault: true, wasSetLate: true, entries: {} }, timestamp: T0 + 400 }, icsHistory: [] } });
  const f2 = runGcmChecks(tab2, buildGcmModel(tab2));
  assert.ok(f2.some((x) => x.id === 'gcm.default_after_tag_load' && /wasSetLate/.test(x.msg)));
  assert.equal(gcmStatus(buildGcmModel(tab2), f2).status, 'error');
});

test('gcm checks: network heuristic is only a warning, skipped when replayed', () => {
  const base = { network: { signals: [{ host: 'www.googletagmanager.com', path: '/gtag/js', type: 'tag_load', timestamp: T0 + 10 }], firstTagLoadAt: T0 + 10, firstCollectAt: null } };
  const tab = blankTab({ ...base, gcm: { events: [ev('default', DEF, T0 + 500, { dlIndex: 0 })], dl: [], ics: null, icsHistory: [] } });
  const f = runGcmChecks(tab, buildGcmModel(tab));
  const net = f.find((x) => x.id === 'gcm.default_after_tag_load_net');
  assert.ok(net && net.sev === 'warn');
  const tabR = blankTab({ ...base, gcm: { events: [ev('default', DEF, T0 + 500, { dlIndex: 0, replayed: true })], dl: [], ics: null, icsHistory: [] } });
  assert.ok(!runGcmChecks(tabR, buildGcmModel(tabR)).some((x) => x.id === 'gcm.default_after_tag_load_net'));
});

test('gcm checks: GTM-template default (ics only) is not "no consent mode"', () => {
  const tab = blankTab({ gcm: { events: [], dl: [{ data: { kind: 'gtm.js', dlIndex: 0 }, timestamp: T0 }], ics: { data: { active: true, usedDefault: true, usedUpdate: false, wasSetLate: false, entries: { ad_storage: { default: false } } }, timestamp: T0 + 100 }, icsHistory: [] }, diagnostics: { gtagData: true, gcmActive: true, tagIds: [{ id: 'GTM-1' }] } });
  const f = runGcmChecks(tab, buildGcmModel(tab));
  assert.ok(!f.some((x) => x.id === 'gcm.no_consent_mode'));
  assert.ok(f.some((x) => x.id === 'gcm.default_via_gtm_template'));
});

test('gcm checks: no consent mode / update without default / ads without gcm / gcs unconfigured', () => {
  const tab = blankTab({ network: { signals: [{ host: 'www.google-analytics.com', path: '/g/collect', type: 'hit', gcs: 'G1--', timestamp: T0 + 100 }], firstTagLoadAt: null, firstCollectAt: T0 + 100 }, diagnostics: { adsActive: true, tagIds: [{ id: 'AW-1' }] } });
  const m = buildGcmModel(tab);
  const ids = runGcmChecks(tab, m).map((x) => x.id);
  assert.ok(ids.includes('gcm.no_consent_mode'));
  assert.ok(ids.includes('gcm.ads_without_gcm'));
  assert.ok(ids.includes('gcm.gcs_unconfigured'));
  const tab2 = blankTab({ gcm: { events: [ev('update', { ad_storage: 'granted' }, T0 + 10, { dlIndex: 0 })], dl: [], ics: null, icsHistory: [] } });
  assert.ok(runGcmChecks(tab2, buildGcmModel(tab2)).some((x) => x.id === 'gcm.update_without_default'));
  assert.equal(runGcmChecks(blankTab(), buildGcmModel(blankTab())).length, 0, 'no google tags → nothing');
  // a TCF-only site with GPT/DoubleClick ad requests but no gtag/GTM is not a Consent Mode failure
  const gptOnly = blankTab({ network: { signals: [{ host: 'securepubads.g.doubleclick.net', path: '/gampad/ads', type: 'hit', subtype: 'ad_request', timestamp: T0 }, { host: 'securepubads.g.doubleclick.net', path: '/pagead/conversion', type: 'hit', subtype: 'conversion', timestamp: T0 + 1 }], firstTagLoadAt: null, firstCollectAt: T0 + 1 } });
  const mg = buildGcmModel(gptOnly);
  assert.equal(mg.googleTagsSeen, false);
  assert.equal(mg.googleTrafficSeen, true);
  assert.equal(runGcmChecks(gptOnly, mg).length, 0, 'GPT-only traffic → no consent mode findings');
});

test('gcm checks: v2 signals missing, wait period timed out, dl vs ics mismatch, retroactive grant', () => {
  const tab = blankTab({
    gcm: { events: [ev('default', { ad_storage: 'denied', analytics_storage: 'denied', wait_for_update: 500 }, T0 + 10, { dlIndex: 0 })], dl: [],
      ics: { data: { active: true, usedDefault: true, usedUpdate: false, waitPeriodTimedOut: true, entries: { ad_storage: { default: false }, analytics_storage: { default: true } } }, timestamp: T0 + 700 }, icsHistory: [] },
    network: { signals: [{ host: 'www.google-analytics.com', path: '/g/collect', type: 'hit', gcs: 'G111', gcd: '13r3r3r3r5l1', timestamp: T0 + 300 }], firstTagLoadAt: null, firstCollectAt: T0 + 300 }
  });
  const ids = runGcmChecks(tab, buildGcmModel(tab)).map((x) => x.id);
  assert.ok(ids.includes('gcm.v2_signals_missing'));
  assert.ok(ids.includes('gcm.wait_period_timed_out'));
  assert.ok(ids.includes('gcm.dl_vs_ics_mismatch'));
  assert.ok(ids.includes('gcm.retroactive_grant'));
});

test('uet model + checks', () => {
  const tab = blankTab({ uet: { apiFound: true, kind: 'object', config: { consent: { enabled: true, adStorageAllowed: false, enforced: true } }, events: [{ data: { command: 'default', params: { ad_storage: 'denied' } }, timestamp: T0 }] },
    network: { signals: [{ host: 'bat.bing.net', path: '/action/0', type: 'bing_hit', asc: 'D', evt: 'pageLoad', timestamp: T0 + 5 }], firstTagLoadAt: null, firstCollectAt: null } });
  const u = buildUetModel(tab);
  assert.equal(u.adStorage, 'denied');
  assert.equal(u.adStorageSource, 'uetConfig.consent');
  assert.equal(u.tagSeen, true);
  assert.equal(u.latestAsc, 'D');
  assert.ok(runUetChecks(tab, u).some((f) => f.id === 'uet.enforced'));
  const bare = blankTab({ network: { signals: [{ host: 'bat.bing.com', path: '/action/0', type: 'bing_hit', timestamp: T0 }], firstTagLoadAt: null, firstCollectAt: null } });
  assert.ok(runUetChecks(bare, buildUetModel(bare)).some((f) => f.id === 'uet.no_consent'));
});

test('tcf model + findings + badge with a compliant CMP', () => {
  const v = vectors.find((x) => x.name === 'cookielet_style_three_segments');
  const d = decode(v.tcString);
  const tab = blankTab({
    tcf: { apiFound: true, locatorFound: true, ping: { data: { cmpId: 503, cmpVersion: 1, cmpLoaded: true, cmpStatus: 'loaded', displayStatus: 'hidden', gdprApplies: true, apiVersion: '2.2', tcfPolicyVersion: 5, gvlVersion: d.vendorListVersion }, timestamp: T0 },
      data: { data: { tcString: v.tcString, cmpId: 503, cmpVersion: 1, gdprApplies: true, eventStatus: 'useractioncomplete', cmpStatus: 'loaded', listenerId: 1, tcfPolicyVersion: 5, isServiceSpecific: true, addtlConsent: '2~70~dv.311', purpose: { consents: Object.fromEntries(d.purposeConsents.map((p) => [p, true])), legitimateInterests: Object.fromEntries(d.purposeLegitimateInterests.map((p) => [p, true])) } }, timestamp: T0 + 1 },
      history: [], pingHistory: [], commands: { ping: { ok: true }, addEventListener: { ok: true }, removeEventListener: { ok: true }, getTCData: { ok: true } }, errors: [], storage: { data: { IABTCF_TCString: v.tcString }, timestamp: T0 } }
  });
  const tcf = buildTcfModel(tab, { gvl: { ...gvl, tcfPolicyVersion: 5 }, cmpList, atp: { 70: { name: 'Adobe' } } });
  assert.equal(tcf.present, true);
  assert.equal(tcf.cmpName, 'cookielet');
  assert.equal(tcf.cmpRegistered, true);
  assert.equal(tcf.phase, 'loaded');
  assert.equal(tcf.counts.vendorsDisclosed, v.expected.disclosedVendors.length);
  assert.match(tcf.summaryLines[0], /Number of purposes the user has expressed consent for: 8/);
  assert.equal(tcf.ac.names[70], 'Adobe');
  assert.equal(tcf.technical.results.technicalComplianceCheck_13, true);
  const models = { gcm: buildGcmModel(tab), tcf, gpp: null, uet: buildUetModel(tab) };
  const findings = collectFindings(tab, models, { gvl: { ...gvl, tcfPolicyVersion: 5 }, cmpList, now: T0 + 1000 });
  assert.deepEqual(findings.filter((f) => f.sev === 'err').map((f) => f.id), []);
  assert.deepEqual(findings.filter((f) => f.sev === 'warn').map((f) => f.id), [], JSON.stringify(findings));
  assert.equal(badgeStatus(findings, models), 'pass');
  // a consented vendor that the GVL marks deleted → technical check #12 fails → error badge
  const withDeleted = { ...tab, tcf: { ...tab.tcf, data: { data: { ...tab.tcf.data.data, tcString: vectors.find((x) => x.name === 'cookielet_style_three_segments').tcString }, timestamp: T0 } } };
  const gvlDel = { ...gvl, vendors: { ...gvl.vendors, 755: { ...gvl.vendors[755], deletedDate: '2025-01-01T00:00:00Z' } } };
  const tcfDel = buildTcfModel(withDeleted, { gvl: { ...gvlDel, tcfPolicyVersion: 5 }, cmpList });
  const fDel = collectFindings(withDeleted, { ...models, tcf: tcfDel }, { gvl: { ...gvlDel, tcfPolicyVersion: 5 }, cmpList, now: T0 + 1000 });
  assert.ok(fDel.some((f) => f.id === 'tcf.technical_failed' && /#12/.test(f.title)));
  assert.equal(badgeStatus(fDel, { ...models, tcf: tcfDel }), 'error');
});

test('tcf findings: unregistered + missing disclosed vendors + stale policy + stub missing', () => {
  const v = vectors.find((x) => x.name === 'service_specific_restriction');
  const tab = blankTab({ tcf: { apiFound: true, locatorFound: true, ping: { data: { cmpId: 504, cmpLoaded: true, cmpStatus: 'loaded', gdprApplies: true, tcfPolicyVersion: 4 }, timestamp: T0 }, data: { data: { tcString: v.tcString, cmpId: 504, gdprApplies: true, eventStatus: 'tcloaded', tcfPolicyVersion: 4, isServiceSpecific: true }, timestamp: T0 }, history: [], pingHistory: [], commands: {}, errors: [], storage: null } });
  const tcf = buildTcfModel(tab, { gvl, cmpList });
  assert.equal(tcf.cmpName, 'NOT FOUND');
  const ids = collectFindings(tab, { gcm: buildGcmModel(tab), tcf, gpp: null, uet: buildUetModel(tab) }, { gvl, cmpList, now: T0 + 1000 }).map((f) => f.id);
  assert.ok(ids.includes('tcf.cmp_unregistered'));
  assert.ok(ids.includes('tcf.missing_disclosed_vendors'));
  assert.ok(ids.includes('tcf.policy_version_api'), 'ping policy 4 vs string 5');
  const stale = buildTcfModel(tab, { gvl: { ...gvl, tcfPolicyVersion: 6 }, cmpList });
  assert.ok(collectFindings(tab, { gcm: buildGcmModel(tab), tcf: stale, gpp: null, uet: buildUetModel(tab) }, { gvl: { ...gvl, tcfPolicyVersion: 6 }, cmpList, now: T0 + 1000 }).some((f) => f.id === 'tcf.policy_version'));
  const noApi = blankTab({ diagnostics: { cmp: { name: 'Cookiebot' } } });
  assert.ok(collectFindings(noApi, { gcm: buildGcmModel(noApi), tcf: buildTcfModel(noApi, {}), gpp: null, uet: buildUetModel(noApi) }).some((f) => f.id === 'tcf.stub_missing'));
});

test('gpp findings and csv export', () => {
  const tab = blankTab({ gpp: { apiFound: true, locatorFound: false, ping: { data: { gppVersion: '1.1', cmpStatus: 'loaded', signalStatus: 'ready', applicableSections: [7], gppString: 'DBACNYA~CPXxRfAPXxRfAAfKABENB-CgAAAAAAAAAAYgAAAAAAAA~1YNN' }, timestamp: T0 }, events: [], data: null, errors: [] } });
  const f = collectFindings(tab, { gcm: buildGcmModel(tab), tcf: buildTcfModel(tab, {}), gpp: null, uet: buildUetModel(tab) });
  assert.ok(f.some((x) => x.id === 'gpp.header_mismatch'), JSON.stringify(f));

  const v = vectors.find((x) => x.name === 'cookielet_style_three_segments');
  const tcfTab = blankTab({ tcf: { apiFound: true, locatorFound: true, ping: { data: { cmpId: 503, cmpLoaded: true, cmpStatus: 'loaded', gdprApplies: true, apiVersion: '2.2', tcfPolicyVersion: 5 }, timestamp: T0 }, data: { data: { tcString: v.tcString, cmpId: 503, gdprApplies: true, eventStatus: 'tcloaded', tcfPolicyVersion: 5, isServiceSpecific: true }, timestamp: T0 }, history: [], pingHistory: [], commands: { ping: { ok: true }, addEventListener: { ok: true }, removeEventListener: { ok: true } }, errors: [], storage: null } });
  const tcf = buildTcfModel(tcfTab, { gvl, cmpList });
  const rows = buildCsvRows({ tcf, checks, manual: { policyComplianceCheck_1: true, technicalComplianceCheck_1: false }, manualTcString: v.tcString });
  assert.deepEqual(rows[0], ['Id', 'Compliance Check Name', 'Result']);
  assert.ok(rows.some((r) => r[1] === 'CMP Found: cookielet'));
  assert.ok(rows.some((r) => r[0] === 1 && r[2] === 'Failed'));
  assert.ok(rows.some((r) => r[1] === 'Is the CMP registered?' && r[2] === 'Passed'));
  assert.ok(rows.some((r) => r[1] === 'TC String manual check' && r[2] === 'Passed'));
  assert.ok(!rows.some((r) => r[1] === 'getTCData response'), 'validator parity: getTCData skipped');
  const csv = buildCsv({ tcf, checks, manual: {}, manualTcString: '' });
  assert.match(csv, /"Are purposes 1, 3, 4, 5, and 6 set to 'no' for legitimate interest\?"/);
});
