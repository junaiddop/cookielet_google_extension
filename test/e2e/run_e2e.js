#!/usr/bin/env node
/**
 * End-to-end test: loads the unpacked extension into headless Chromium (CDP over pipe,
 * no dependencies), opens each fixture page, reads the worker's per-tab record from
 * chrome.storage.session, rebuilds the models/findings with the shared library and asserts.
 *
 *   node test/e2e/run_e2e.js            # all fixtures
 *   CHROME_BIN=/path/to/chrome node test/e2e/run_e2e.js
 *   E2E_KEEP=1                          # keep the browser open for 30 s at the end (debugging)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.js';
import { start } from './serve.js';
import { buildGcmModel } from '../../src/shared/gcm/gcm_model.js';
import { buildTcfModel } from '../../src/shared/tcf/tcf_model.js';
import { buildUetModel } from '../../src/shared/uet/uet_model.js';
import { collectFindings, badgeStatus } from '../../src/shared/checks/findings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SW_PATH = 'src/background/service_worker.js';
const TC = 'CQoRCYAQoRCYAH3ABBENCuFoAPPAAEPgAAYgF5wA4AAgAEAAoBeYF5wAQF5gAAAA';

let failures = 0, passes = 0;
function check(cond, label, extra) {
  if (cond) { passes++; console.log('  ✓ ' + label); }
  else { failures++; console.log('  ✗ ' + label + (extra !== undefined ? '  [' + JSON.stringify(extra).slice(0, 300) + ']' : '')); }
}
const ids = (f) => f.map((x) => x.id);

async function recordFor(sw, urlPart, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const all = await sw.evaluate('chrome.storage.session.get(null)');
    const rec = Object.values(all).find((v) => v && v.pageUrl && v.pageUrl.includes(urlPart));
    if (rec && rec.instrumented) return rec;
    await sleep(250);
  }
  const all = await sw.evaluate('chrome.storage.session.get(null)');
  return Object.values(all).find((v) => v && v.pageUrl && v.pageUrl.includes(urlPart)) || null;
}
function models(rec) {
  const all = { gcm: buildGcmModel(rec), tcf: buildTcfModel(rec, {}), uet: buildUetModel(rec), gpp: null };
  return { all, m: all.gcm, findings: collectFindings(rec, all, {}) };
}

async function run() {
  const srv = await start(8899);
  const browser = await launch(ROOT);
  let page = null;
  try {
    const sw = await browser.serviceWorker(SW_PATH);
    console.log('extension', sw.extensionId, '· fixtures', srv.url);

    /* ---------- gcm-correct ---------- */
    console.log('\n[gcm-correct]');
    page = await browser.openPage(srv.url + '/gcm-correct.html');
    await sleep(2500);
    let rec = await recordFor(sw, 'gcm-correct');
    check(!!rec, 'record captured', rec && Object.keys(rec));
    if (rec) {
      const { all, m, findings } = models(rec);
      check(rec.instrumented && rec.documentId, 'instrumented with documentId');
      check(m.defaultCount === 1 && m.updateCount === 1, 'default + update captured', { d: m.defaultCount, u: m.updateCount });
      check(m.defaults.ad_storage === 'denied' && m.defaultScope.ad_storage === 'region:DE,FR', 'region-scoped default resolved', m.defaultScope);
      check(m.setFlags.ads_data_redaction === true, 'gtag set ads_data_redaction captured');
      check(m.dl.consentDefaultIndex === 0 && m.dl.firstJsIndex === 2 && m.dl.firstConfigIndex === 3, 'dataLayer indices', m.dl);
      check(m.ics && m.icsFlags.usedDefault && m.icsFlags.usedUpdate && !m.icsFlags.wasSetLate, 'google_tag_data.ics observed (usedDefault, usedUpdate, !wasSetLate)', m.icsFlags);
      check(m.icsSignals.ad_storage.effective === 'granted' && m.icsSignals.ad_storage.source === 'update', 'ics effective state after update');
      const hits = rec.network.signals.filter((s) => s.type === 'hit');
      check(hits.length >= 2 && hits.some((h) => h.gcd && h.gcs === 'G100') && hits.some((h) => h.gcu === '1' && h.gcs === 'G111'), 'network hits with gcs/gcd (denied then granted, gcu on update)', hits.map((h) => [h.host, h.gcs, h.gcd, h.gcu]));
      check(m.latestGcd && m.latestGcd.signals.ad_storage.label === 'Denied by default, granted after update', 'latest gcd decodes to r-letters', m.latestGcd && m.latestGcd.raw);
      check(!findings.some((f) => f.sev === 'err'), 'no error findings', ids(findings.filter((f) => f.sev === 'err')));
      check(!findings.some((f) => f.id === 'gcm.default_after_tag_load' || f.id === 'gcm.default_after_tag_load_net'), 'no late-default finding', ids(findings));
      check(findings.some((f) => f.id === 'gcm.url_passthrough'), 'best-practice info present', ids(findings));
      check(badgeStatus(findings, all) === 'pass', 'badge pass', badgeStatus(findings, all));
      check((rec.diagnostics.tagIds || []).some((t) => t.id === 'G-TEST'), 'tag id detected', rec.diagnostics.tagIds);
      check(rec.tcf.apiFound === false && rec.gpp.apiFound === false, 'no TCF/GPP on this page');
      const errors = page.console.filter((l) => /error/i.test(l) && /Cookielet/.test(l));
      check(errors.length === 0, 'no inspector console output (silent)', page.console.filter((l) => /Cookielet/.test(l)).slice(0, 3));
    }
    await page.close();

    /* ---------- gcm-late-default ---------- */
    console.log('\n[gcm-late-default]');
    page = await browser.openPage(srv.url + '/gcm-late-default.html');
    await sleep(2000);
    rec = await recordFor(sw, 'gcm-late-default');
    check(!!rec, 'record captured');
    if (rec) {
      const { all, m, findings } = models(rec);
      check(m.icsFlags.wasSetLate === true, 'ics.wasSetLate true', m.icsFlags);
      check(m.dl.consentDefaultIndex > m.dl.firstConfigIndex, 'dataLayer order: default after config', m.dl);
      const late = findings.find((f) => f.id === 'gcm.default_after_tag_load');
      check(late && late.sev === 'err', 'late-default error finding', ids(findings));
      check(badgeStatus(findings, all) === 'error', 'badge error');
    }
    await page.close();

    /* ---------- gcm-no-default ---------- */
    console.log('\n[gcm-no-default]');
    page = await browser.openPage(srv.url + '/gcm-no-default.html');
    await sleep(2000);
    rec = await recordFor(sw, 'gcm-no-default');
    check(!!rec, 'record captured');
    if (rec) {
      const { all, m, findings } = models(rec);
      check(m.googleTagsSeen && m.adsActive, 'Google Ads tag detected', { tags: rec.diagnostics.tagIds, ads: m.adsActive });
      check(findings.some((f) => f.id === 'gcm.no_consent_mode' && f.sev === 'err'), 'no-consent-mode error', ids(findings));
      check(findings.some((f) => f.id === 'gcm.ads_without_gcm'), 'ads without consent mode warning', ids(findings));
    }
    await page.close();

    /* ---------- gtm-template ---------- */
    console.log('\n[gtm-template]');
    page = await browser.openPage(srv.url + '/gtm-template.html');
    await sleep(2000);
    rec = await recordFor(sw, 'gtm-template');
    check(!!rec, 'record captured');
    if (rec) {
      const { all, m, findings } = models(rec);
      check(m.defaultCount === 0 && m.icsFlags.usedDefault === true, 'default only in ics', { d: m.defaultCount, ics: m.icsFlags });
      check(!findings.some((f) => f.id === 'gcm.no_consent_mode'), 'GTM-template default is not "no consent mode"', ids(findings));
      check(findings.some((f) => f.id === 'gcm.default_via_gtm_template'), 'gtm-template info', ids(findings));
      check(m.dl.gtmJsIndex === 0 && m.dl.gtmLoadIndex > 0, 'gtm.js / gtm.load captured', m.dl);
      check(m.gtmLoaded && (rec.diagnostics.tagIds || []).some((t) => t.id === 'GTM-FAKE1'), 'GTM container id detected');
    }
    await page.close();

    /* ---------- tcf-cmp ---------- */
    console.log('\n[tcf-cmp]');
    page = await browser.openPage(srv.url + '/tcf-cmp.html');
    await sleep(3500);
    rec = await recordFor(sw, 'tcf-cmp');
    check(!!rec, 'record captured');
    if (rec) {
      const { all, m, findings } = models(rec);
      const t = rec.tcf;
      check(t.apiFound && t.locatorFound, '__tcfapi + __tcfapiLocator found', { api: t.apiFound, loc: t.locatorFound });
      check(t.pingHistory.some((p) => p.cmpStatus === 'stub') && t.ping.data.cmpStatus === 'loaded', 'stub → loaded transition observed', t.pingHistory.map((p) => p.cmpStatus));
      check(t.ping.data.cmpId === 503 && t.ping.data.gdprApplies === true, 'ping data from the real CMP');
      check(t.data && t.data.data.tcString.startsWith(TC), 'TC string from addEventListener', t.data && t.data.data.tcString && t.data.data.tcString.slice(0, 20));
      check(t.history.some((e) => e.eventStatus === 'tcloaded') && t.history.some((e) => e.eventStatus === 'useractioncomplete'), 'eventStatus timeline', t.history.map((e) => e.eventStatus));
      check(t.commands.ping && t.commands.ping.ok && t.commands.addEventListener.ok && t.commands.removeEventListener.ok, 'required commands ok', t.commands);
      check(t.commands.getVendorList && t.commands.getVendorList.ok && t.commands.getVendorList.note.vendorListVersion === 174, 'getVendorList summary', t.commands.getVendorList);
      check(t.storage && t.storage.data.IABTCF_TCString.startsWith(TC) && t.storage.data['cookie:euconsent-v2'], 'IABTCF_* storage + euconsent-v2 cookie snapshot', t.storage && Object.keys(t.storage.data));
      check(all.tcf.phase === 'loaded' && all.tcf.decoded && all.tcf.decoded.hasDisclosedVendorsSegment, 'model: loaded + three-segment string decoded');
      check(all.tcf.technical.results.technicalComplianceCheck_4 === true && all.tcf.technical.results.technicalComplianceCheck_13 === true, 'technical checks #4 and #13 pass (no GVL needed)', all.tcf.technical.results);
      check(all.tcf.ac && all.tcf.ac.valid && all.tcf.ac.consented.join() === '70,311', 'Additional Consent parsed', all.tcf.ac);
      check(!findings.some((f) => f.tab === 'tcf' && f.sev === 'err'), 'no TCF error findings', ids(findings.filter((f) => f.tab === 'tcf')));
      const g = rec.gpp;
      check(g.apiFound && g.ping && g.ping.data.signalStatus === 'ready', 'GPP ping ready', g.ping && g.ping.data.signalStatus);
      check(g.sections.tcfeuv2 === true && g.sections.usnat === false, 'GPP hasSection probes', g.sections);
      check(g.commands.addEventListener && g.commands.addEventListener.ok && g.commands.removeEventListener && g.commands.removeEventListener.ok, 'GPP listener commands', g.commands);
      check(!findings.some((f) => f.id === 'gpp.header_mismatch'), 'GPP header consistent', ids(findings));
      const u = rec.uet;
      check(u.apiFound && u.kind === 'object' && u.events.some((e) => e.data.command === 'default') && u.events.some((e) => e.data.command === 'update'), 'UET queue hooked across bat.js replacement', { kind: u.kind, events: u.events.map((e) => e.data.command) });
      check(all.uet.adStorage === 'granted' && all.uet.tagRequests.some((r) => r.asc === 'D') && all.uet.tagRequests.some((r) => r.asc === 'G'), 'UET beacons with asc D then G', { recorded: rec.network.signals.filter((s) => /bing/.test(s.host)).map((s) => [s.host, s.path, s.type, s.asc]), attempted: page.requests.filter((u) => /bing/.test(u)).map((u) => u.slice(0, 80)) });
      check(m.icsFlags.usedUpdate && m.updateCount === 1, 'CMP accept produced gtag consent update');
      check(rec.diagnostics.cmp && rec.diagnostics.cmp.name === 'Cookielet', 'CMP fingerprint (Cookielet)', rec.diagnostics.cmp);
      check(m.latestTcfd && m.latestTcfd.cmpId === 503, 'tcfd param decoded', m.latestTcfd);

      // manual re-injection (popup ENSURE_INJECTED path): must merge, not reset
      const revBefore = rec.rev;
      const tabId = (await sw.evaluate('chrome.tabs.query({}).then(ts => ts.filter(t => t.url && t.url.includes("tcf-cmp")).map(t => t.id))'))[0];
      await sw.evaluate(`chrome.scripting.executeScript({target:{tabId:${tabId}}, files:['src/content/content_script.js'], world:'ISOLATED', injectImmediately:true}).then(() => chrome.scripting.executeScript({target:{tabId:${tabId}}, files:['src/content/page_injector.js'], world:'MAIN', injectImmediately:true})).then(() => 'ok')`);
      await sleep(800);
      const rec2 = await recordFor(sw, 'tcf-cmp');
      check(rec2.rev > revBefore && rec2.documentId === rec.documentId && rec2.tcf.history.length >= rec.tcf.history.length && rec2.network.signals.length >= rec.network.signals.length, 're-injection merges into the same document record', { rev: [revBefore, rec2.rev] });
      check(rec2.gcm.events.some((e) => e.data.replayed === true), 'replayed dataLayer entries are marked');

      // REPROBE round-trip through the relay
      const r = await sw.evaluate(`chrome.tabs.sendMessage(${tabId}, {action:'PAGE_CMD', cmd:'REPROBE'}, {frameId:0})`);
      check(r && r.ok, 'PAGE_CMD REPROBE acknowledged by the relay', r);
      await sleep(600);
      const rec3 = await recordFor(sw, 'tcf-cmp');
      check(rec3.rev > rec2.rev, 'REPROBE produced a new snapshot');
    }
    await page.close();

    /* ---------- no-cmp + SPA ---------- */
    console.log('\n[no-cmp]');
    page = await browser.openPage(srv.url + '/no-cmp.html');
    await sleep(1500);
    rec = await recordFor(sw, 'no-cmp');
    check(!!rec && rec.instrumented, 'record captured');
    if (rec) {
      const { all, m, findings } = models(rec);
      check(!m.googleTagsSeen && findings.length === 0, 'nothing to report', ids(findings));
      check(rec.pageUrl.includes('spa=1') && rec.urlHistory.length === 1, 'pushState URL change tracked', rec.urlHistory);
      check(m.dataLayerDefined === false, 'page without dataLayer is not given one', rec.diagnostics && rec.diagnostics.dataLayer);
      check(badgeStatus(findings, all) === 'none', 'badge none');
    }
    await page.close();

    /* ---------- navigation reset ---------- */
    console.log('\n[navigation reset]');
    page = await browser.openPage(srv.url + '/gcm-correct.html');
    await sleep(1500);
    await page.navigate(srv.url + '/index.html?second=1');
    await sleep(1200);
    rec = await recordFor(sw, 'second=1');
    check(!!rec && rec.gcm.events.length === 0 && rec.network.signals.filter((s) => s.host.includes('google')).length === 0, 'new document starts from a blank record', rec && { ev: rec.gcm.events.length, net: rec.network.signals.length });
    await page.close();

    /* ---------- popup loads ---------- */
    console.log('\n[popup]');
    page = await browser.openPage('chrome-extension://' + sw.extensionId + '/src/popup/popup.html');
    await sleep(1200);
    const guardText = await page.evaluate("document.getElementById('guard').textContent");
    const errs = page.console.filter((l) => /error|uncaught|failed to/i.test(l));
    check(errs.length === 0, 'popup loads without console errors', errs.slice(0, 3));
    check(/Navigate to a website/.test(guardText), 'popup guard for an extension page', guardText);
    // render every view against a real record inside the popup document
    const all = await sw.evaluate('chrome.storage.session.get(null)');
    const sample = Object.values(all).find((v) => v && v.pageUrl && v.pageUrl.includes('tcf-cmp')) || Object.values(all)[0];
    if (sample) {
      const renderErr = await page.evaluate(`(async () => {
        const rec = ${JSON.stringify(sample)};
        const [{ buildGcmModel }, { buildTcfModel }, { buildUetModel }, { collectFindings }] = await Promise.all([import('../shared/gcm/gcm_model.js'), import('../shared/tcf/tcf_model.js'), import('../shared/uet/uet_model.js'), import('../shared/checks/findings.js')]);
        const checks = await (await fetch(chrome.runtime.getURL('src/data/tcf_checks.json'))).json();
        const models = { gcm: buildGcmModel(rec), tcf: buildTcfModel(rec, {}), uet: buildUetModel(rec), gpp: null };
        const ctx = { tab: rec, models, findings: collectFindings(rec, models, {}), gvlState: { gvl: null, cmpList: null, atp: null, errors: {} }, manual: {}, host: 'x', actions: { setManual(){}, toggleInfo(){}, refreshGvl(){} }, checksData: checks, ui: { infoOpen: new Set() } };
        const out = [];
        for (const name of ['overview','gcm','tcf','gpp','uet','about']) { const v = await import('./views/' + name + '.js'); const div = document.createElement('div'); try { v.render(ctx, div); out.push(name + ':' + div.childElementCount); } catch (e) { out.push(name + ':ERROR ' + e.message); } }
        return out.join(' ');
      })()`);
      check(!/ERROR/.test(renderErr) && /tcf:\d+/.test(renderErr), 'all views render a real record', renderErr);
    }
    await page.close();

    if (process.env.E2E_KEEP) await sleep(30000);
  } catch (e) {
    failures++;
    console.log('  ✗ harness failure: ' + (e && e.stack || e));
  } finally {
    try { if (page) await page.close(); } catch (e) { /* ignore */ }
    await browser.close();
    await srv.close();
  }
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
}

run();
