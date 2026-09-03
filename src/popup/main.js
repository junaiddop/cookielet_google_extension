/**
 * Popup / side panel entry (ESM).
 *  - reads the active tab's record from the worker (GET_TAB_DATA), re-rendering only when `rev` changes
 *  - preserves <details> open state across renders; manual paste lives outside the re-rendered subtree
 *  - requests injection once per uninstrumented tab, GVL/cmp-list once per session (+ per TC string version)
 */
import { MSG, STORAGE_KEYS, isUninspectableUrl } from '../shared/constants.js';
import { buildGcmModel } from '../shared/gcm/gcm_model.js';
import { buildTcfModel } from '../shared/tcf/tcf_model.js';
import { buildUetModel } from '../shared/uet/uet_model.js';
import { collectFindings } from '../shared/checks/findings.js';
import { buildJsonReport, buildCsv, reportFilename, download, safeHost } from '../shared/report/export.js';
import { h, clear } from '../shared/util/dom.js';
import * as overview from './views/overview.js';
import * as gcmView from './views/gcm.js';
import * as tcfView from './views/tcf.js';
import * as gppView from './views/gpp.js';
import * as uetView from './views/uet.js';
import * as aboutView from './views/about.js';

const VIEWS = { overview, gcm: gcmView, tcf: tcfView, gpp: gppView, uet: uetView, about: aboutView };
const IS_PANEL = document.body.dataset.ctx === 'sidepanel';

const state = {
  tabId: null, tabUrl: null, tab: null, renderedRev: -1, renderedTab: null, renderedGvlAt: 0, renderedManualAt: 0,
  gvlState: { gvl: null, cmpList: null, atp: null, versioned: null, fetchedAt: null, errors: {} }, gvlRequestedVersion: null, gvlAt: 0,
  manual: {}, manualHost: null, manualAt: 0, injectionTried: new Set(), checksData: null, ui: { infoOpen: new Set() }, activeView: 'overview', models: null, findings: []
};

const $ = (id) => document.getElementById(id);
function send(msg) { return new Promise((resolve) => { try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r); }); } catch (e) { resolve(null); } }); }

/* ---------------- tabs ---------------- */
document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => activate(btn.dataset.tab)));
function activate(name) {
  state.activeView = name;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.view === name));
  try { localStorage.setItem('ci.activeView', name); } catch (e) { /* ignore */ }
}
try { const saved = localStorage.getItem('ci.activeView'); if (saved && VIEWS[saved]) activate(saved); } catch (e) { /* ignore */ }

/* ---------------- side panel ---------------- */
const sidePanelBtn = $('sidePanelBtn');
if (!IS_PANEL && chrome.sidePanel && chrome.sidePanel.open) {
  sidePanelBtn.addEventListener('click', () => {
    if (state.tabId == null) return;
    chrome.sidePanel.open({ tabId: state.tabId }).then(() => window.close()).catch(() => {}); // must be synchronous in the gesture
  });
} else sidePanelBtn.hidden = true;

/* ---------------- actions ---------------- */
const actions = {
  setManual: async (checkId, value) => {
    if (!state.manualHost) return;
    const r = await send({ action: MSG.SET_MANUAL, host: state.manualHost, checkId, value });
    if (r && r.responses) { state.manual = r.responses; state.manualAt = Date.now(); renderAll(true); }
  },
  toggleInfo: (checkId) => { if (state.ui.infoOpen.has(checkId)) state.ui.infoOpen.delete(checkId); else state.ui.infoOpen.add(checkId); renderAll(true); },
  refreshGvl: () => loadGvl({ force: true })
};

$('exportJsonBtn').addEventListener('click', () => {
  if (!state.tab) return;
  const report = buildJsonReport({ tab: state.tab, models: state.models, findings: state.findings, manual: state.manual, extensionVersion: chrome.runtime.getManifest().version, gvlState: state.gvlState });
  download(reportFilename('json', state.tab.pageUrl || state.tabUrl), 'application/json', JSON.stringify(report, null, 2));
});
$('exportCsvBtn').addEventListener('click', () => {
  if (!state.tab || !state.checksData) return;
  const csv = buildCsv({ tcf: state.models.tcf, checks: state.checksData, manual: state.manual, manualTcString: $('tcfManualPaste').value });
  download(reportFilename('csv', state.tab.pageUrl || state.tabUrl), 'text/csv', csv);
});
$('reprobeBtn').addEventListener('click', async (ev) => {
  if (ev.shiftKey) { // hidden toggle for debug logging
    const cur = await new Promise((res) => chrome.storage.local.get('debug', (r) => res(!!(r && r.debug))));
    await send({ action: MSG.SET_DEBUG, value: !cur });
    $('reprobeBtn').textContent = 'Re-probe' + (!cur ? ' (debug on)' : '');
    return;
  }
  if (state.tabId == null) return;
  $('reprobeBtn').disabled = true;
  await send({ action: MSG.REPROBE, tabId: state.tabId });
  setTimeout(() => { $('reprobeBtn').disabled = false; refresh(); }, 600);
});
$('clearBtn').addEventListener('click', async () => {
  if (state.tabId == null) return;
  await send({ action: MSG.CLEAR_TAB, tabId: state.tabId });
  state.renderedRev = -1; state.injectionTried.delete(state.tabId);
  refresh();
});
$('tcfManualPaste').addEventListener('input', () => { if (state.models) tcfView.renderManualPaste({ models: state.models }, $('tcfManualPaste'), $('tcfManualResult')); });

/* ---------------- data ---------------- */
async function loadChecks() {
  try { state.checksData = await (await fetch(chrome.runtime.getURL('src/data/tcf_checks.json'))).json(); }
  catch (e) { state.checksData = { technical: [], policy: [], cmpApi: [], summary: {} }; }
}

async function loadGvl({ force = false, version = null } = {}) {
  const r = await send({ action: MSG.GET_GVL, force, version: version || undefined });
  if (r) { state.gvlState = r; state.gvlAt = Date.now(); if (version) state.gvlRequestedVersion = version; renderAll(true); }
}

async function loadManual(host) {
  state.manualHost = host;
  const r = await send({ action: MSG.GET_MANUAL, host });
  state.manual = (r && r.responses) || {};
  state.manualAt = Date.now();
}

function showGuard(text, hint) {
  const g = $('guard');
  clear(g);
  g.appendChild(h('strong', { text }));
  if (hint) g.appendChild(h('span', { class: 'muted', text: hint }));
  g.hidden = false;
  $('loading').hidden = true;
  document.querySelectorAll('.tab-pane').forEach((p) => { p.hidden = true; });
  $('cmpStatusBadge').className = 'badge badge-muted';
  $('cmpStatusBadge').textContent = 'Unavailable';
}
function hideGuard() { $('guard').hidden = true; document.querySelectorAll('.tab-pane').forEach((p) => { p.hidden = false; }); }

async function refresh() {
  let tabs;
  try { tabs = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (e) { return; }
  const t = tabs && tabs[0];
  if (!t) return;
  const changedTab = t.id !== state.tabId;
  state.tabId = t.id; state.tabUrl = t.url || t.pendingUrl || null;
  if (changedTab) { state.renderedRev = -1; state.ui.infoOpen.clear(); }

  if (!state.tabUrl || isUninspectableUrl(state.tabUrl)) {
    const isFile = /^file:/i.test(state.tabUrl || '');
    showGuard('Navigate to a website and reopen this panel to check consent data.',
      isFile ? 'file:// pages need "Allow access to file URLs" in chrome://extensions.' : 'Chrome blocks extensions on internal pages, the Web Store and other extensions.');
    return;
  }
  hideGuard();
  const host = safeHost(state.tabUrl);
  if (host !== state.manualHost) await loadManual(host);

  const data = await send({ action: MSG.GET_TAB_DATA, tabId: state.tabId });
  if (!data || !data.instrumented) {
    if (!state.injectionTried.has(state.tabId)) {
      state.injectionTried.add(state.tabId);
      const r = await send({ action: MSG.ENSURE_INJECTED, tabId: state.tabId });
      if (r && !r.ok) showInjectionNotice(r.error);
      setTimeout(refresh, 700);
    }
  }
  if (!data) { $('loading').hidden = false; return; }
  $('loading').hidden = true;
  state.tab = data;
  $('pageUrl').textContent = data.pageUrl || state.tabUrl || '';
  $('pageUrl').title = data.pageUrl || state.tabUrl || '';
  renderAll(false);

  // fetch the archived GVL matching the TC string's version once per version
  const tcf = state.models && state.models.tcf;
  if (tcf && tcf.decoded && !tcf.decoded.error && state.gvlState.gvl && tcf.decoded.vendorListVersion !== state.gvlState.gvl.vendorListVersion && state.gvlRequestedVersion !== tcf.decoded.vendorListVersion) {
    state.gvlRequestedVersion = tcf.decoded.vendorListVersion;
    loadGvl({ version: tcf.decoded.vendorListVersion });
  }
}

function showInjectionNotice(err) {
  const g = $('guard');
  clear(g);
  g.appendChild(h('strong', { text: 'Could not inspect this page' + (err ? ' (' + err + ')' : '') }));
  g.appendChild(h('span', { class: 'muted', text: 'Reload the page with the inspector installed, or check that site access is allowed for this extension.' }));
  g.hidden = false;
}

/* ---------------- rendering ---------------- */
function openKeys(root) { return new Set([...root.querySelectorAll('details[data-key][open]')].map((d) => d.dataset.key)); }
function restoreKeys(root, keys) { root.querySelectorAll('details[data-key]').forEach((d) => { if (keys.has(d.dataset.key)) d.setAttribute('open', ''); else if (d.dataset.key !== 'tcf-manual-paste') d.removeAttribute('open'); }); }

function renderAll(force) {
  const t = state.tab;
  if (!t) return;
  if (!force && t.rev === state.renderedRev && state.renderedTab === state.tabId && state.renderedGvlAt === state.gvlAt && state.renderedManualAt === state.manualAt) return;
  state.renderedRev = t.rev; state.renderedTab = state.tabId; state.renderedGvlAt = state.gvlAt; state.renderedManualAt = state.manualAt;

  const g = state.gvlState;
  const models = { gcm: buildGcmModel(t), tcf: buildTcfModel(t, { gvl: g.gvl, gvlForVersion: g.versioned, cmpList: g.cmpList, atp: g.atp }), uet: buildUetModel(t), gpp: null };
  const findings = collectFindings(t, models, { gvl: g.gvl, cmpList: g.cmpList });
  state.models = models; state.findings = findings;
  const ctx = { tab: t, models, findings, gvlState: g, manual: state.manual, host: state.manualHost, actions, checksData: state.checksData || { technical: [], policy: [], cmpApi: [] }, ui: state.ui };

  renderHeader(t, models, findings);
  for (const [name, view] of Object.entries(VIEWS)) {
    const root = name === 'tcf' ? $('tcfDynamic') : $('view-' + name);
    const keys = openKeys(root);
    const firstRender = !root.dataset.rendered;
    try { view.render(ctx, root); } catch (e) { clear(root); root.appendChild(h('p', { class: 'state denied', text: 'Render error: ' + (e && e.message) })); }
    root.dataset.rendered = '1';
    if (!firstRender) restoreKeys(root, keys);
  }
  tcfView.renderManualPaste(ctx, $('tcfManualPaste'), $('tcfManualResult'));
}

function renderHeader(t, models, findings) {
  const badge = $('cmpStatusBadge');
  const errs = findings.filter((c) => c.sev === 'err').length;
  const warns = findings.filter((c) => c.sev === 'warn').length;
  badge.className = 'badge';
  if (errs) { badge.classList.add('badge-err'); badge.textContent = errs + ' error' + (errs > 1 ? 's' : ''); }
  else if (warns) { badge.classList.add('badge-warn'); badge.textContent = warns + ' warning' + (warns > 1 ? 's' : ''); }
  else if (models.tcf.present || models.gcm.defaultCount || (models.gcm.icsFlags && models.gcm.icsFlags.usedDefault)) { badge.classList.add('badge-ok'); badge.textContent = 'Looks good'; }
  else if (!t.instrumented) { badge.classList.add('badge-muted'); badge.textContent = 'Waiting for page'; }
  else { badge.classList.add('badge-muted'); badge.textContent = 'No CMP detected'; }
}

/* ---------------- boot ---------------- */
(async function boot() {
  await loadChecks();
  refresh();
  loadGvl();
  try {
    chrome.storage.session.onChanged.addListener((changes) => { if (state.tabId != null && changes[STORAGE_KEYS.tab(state.tabId)]) refresh(); });
  } catch (e) { /* older Chrome: interval only */ }
  if (IS_PANEL) {
    try { chrome.tabs.onActivated.addListener(() => refresh()); chrome.tabs.onUpdated.addListener((id, info) => { if (id === state.tabId && (info.status === 'complete' || info.url)) refresh(); }); } catch (e) { /* ignore */ }
  }
  setInterval(refresh, 2000);
})();
