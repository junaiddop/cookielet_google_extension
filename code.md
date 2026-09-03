# code.md — where each feature lives

Quick reference: feature → files (entry point first). Paths are relative to
`cookielet_google_extension/`. See [CLAUDE.md](CLAUDE.md) for the rules and
[docs/DESIGN.md](docs/DESIGN.md) for the contracts.

## Runtime plumbing

| Feature | Files |
|---|---|
| Manifest, permissions, side panel, MAIN-world content script | `manifest.json`, `_locales/en/messages.json` |
| Page instrumentation (MAIN world): hooks, probes, snapshots | `src/content/page_injector.js` |
| Relay page ⇄ worker, `PAGE_CMD` forwarding, debug flag in HELLO | `src/content/content_script.js` |
| Worker entry: messages (`RECORD`, `GET_TAB_DATA`, `ENSURE_INJECTED`, `REPROBE`, `CLEAR_TAB`, `GET_GVL`, `GET_MANUAL`, `SET_MANUAL`, `SET_DEBUG`), badge, lifecycle | `src/background/service_worker.js` |
| Per-tab record shape, serialized apply, documentId reset/merge, persistence + quota trimming | `src/background/state.js` (`blankTab`, `TabStore`) |
| webRequest observer: navigation reset, Google/Bing/first-party classification, consent params | `src/background/network.js` |
| GVL / cmp-list / ATP cache (storage.local, TTL, LRU archives) | `src/background/gvl_service.js`, fetchers in `src/shared/tcf/gvl.js` |
| Message/event/URL/cap constants, `isUninspectableUrl()` | `src/shared/constants.js` |
| Popup + side panel shell, tabs, refresh loop, exports, injection request, guard | `src/popup/popup.html`, `src/popup/sidepanel.html`, `src/popup/main.js`, `src/popup/popup.css` |
| Reusable UI pieces (cards, banner, findings list, sections, tables, JSON box) | `src/popup/components.js`, `src/shared/util/dom.js` |

## Google Consent Mode v2

| Feature | Files |
|---|---|
| dataLayer `consent default/update/declare` + `set` flags capture (with `dlIndex`, replay marking) | `src/content/page_injector.js` → `inspectDLItem`, `hookDataLayer`, `hookCustomDataLayers` |
| `gtm.js` / `gtm.dom` / `gtm.load` / `js` / `config` ordering events | `page_injector.js` → `inspectDLItem` (`DL_EVENT`) |
| `google_tag_data.ics` snapshot (entries + flags) | `page_injector.js` → `readIcs`, `snapshotIcs` |
| Diagnostics: tag ids (dataLayer, tidr, google_tag_manager), gtag/GTM/Ads presence, CMP fingerprint, TCF bridge, GPC | `page_injector.js` → `collectDiagnostics`, `collectTagIds`, `detectCmp` |
| Model: defaults (global / region-resolved), updates, ics effective state, dataLayer indices, network summaries | `src/shared/gcm/gcm_model.js` |
| Rules (`gcm.*` findings) incl. set-late precedence, GTM-template default, TCF bridge, retroactive grant, mismatches | `src/shared/gcm/gcm_checks.js` |
| Status banner + card semantics (UniConsent parity) | `gcm_checks.js` → `gcmStatus`; `src/popup/views/gcm.js`, `views/overview.js` |
| `gcs` / `gcd` (positional, declare/implicit aware) / `tcfd` decoders + Signal Breakdown labels | `src/shared/gcm/gcd_parser.js` |
| Network Signals table, Consent Events log, Signal Breakdown, detected tags | `src/popup/views/gcm.js` |
| Network capture of `gcs gcd npa dma dma_cps gdpr gdpr_consent tcfd gcu gcut pscdl` | `src/background/network.js` |

## IAB TCF

| Feature | Files |
|---|---|
| TC string decoder (core + DisclosedVendors + legacy AllowedVendors + PublisherTC), byte size, segment types | `src/shared/tcf/tc_decoder.js` |
| Google Additional Consent (v1/v2, duplicates) | `src/shared/tcf/ac_parser.js` |
| GVL v3 / Global CMP List trimming, deleted vendors, CMP deletedDate status, ATP CSV parser, fetchers | `src/shared/tcf/gvl.js` |
| Technical compliance checks #4–#13 (automated) | `src/shared/tcf/technical_checks.js` |
| Check catalogue (texts, manual steps, policy references), summaries `passed/failed/to do` | `src/data/tcf_checks.json`, `src/shared/tcf/policy_checks.js` |
| TCF model: summary fields, counts, summary lines, phase, CMP registration, API rows | `src/shared/tcf/tcf_model.js` |
| TCF findings (`tcf.*`: unregistered/deleted CMP, missing DisclosedVendors, policy version, storage mismatch, AC…) | `src/shared/checks/findings.js` → `runTcfChecks` |
| `__tcfapi` probing: stub→loaded ping polling, addEventListener/removeEventListener/getTCData/getInAppTCData/getVendorList, locator-only postMessage proxy | `src/content/page_injector.js` → `probeTcf`, `tcfPing`, `makeTcfProxy`, `tickTcf` |
| IABTCF_* localStorage + `euconsent-v2` cookie snapshot | `page_injector.js` → `snapshotStorage` |
| TCF tab UI: summary, technical/policy rows with Pass/Fail + ℹ, CMP & API check, TC String Check, purposes/features/vendors with names, restrictions, AC, storage, history, JSON | `src/popup/views/tcf.js` |
| Manual TC string paste (decode + compare) | `views/tcf.js` → `renderManualPaste`, static block in `popup.html` |
| Manual policy answers stored per site | `service_worker.js` → `getManual`/`setManual`; `main.js` → `actions.setManual` |
| CSV (IAB layout) / JSON report, download | `src/shared/report/export.js`, `src/shared/util/csv.js`; buttons in `main.js` |

## IAB GPP

| Feature | Files |
|---|---|
| `__gpp` 1.1 probes (ping until ready, addEventListener/removeEventListener, hasSection per supportedAPIs, legacy getGPPData, 1.0 sync return) | `page_injector.js` → `probeGpp`, `gppPing`, `probeGppSections`, `tickGpp` |
| GPP header decode (Fibonacci ranges, section names) | `src/shared/gpp/gpp_header.js` |
| GPP findings (`gpp.*`) | `findings.js` → `runGppChecks` |
| GPP tab UI | `src/popup/views/gpp.js` |

## Microsoft UET

| Feature | Files |
|---|---|
| `uetq` accessor hook (array → UET instance), consent pushes, `uetConfig` state | `page_injector.js` → `hookUet`, `adoptUet`, `readUetConfig`, `replayUetArray` |
| bat.bing.com / bat.bing.net beacon capture (`asc`, `evt`, `gasc`) | `src/background/network.js` |
| UET model + findings (`uet.*`) | `src/shared/uet/uet_model.js` |
| UET tab UI | `src/popup/views/uet.js` |

## Cross-cutting

| Feature | Files |
|---|---|
| Findings aggregation and ordering, badge status | `src/shared/checks/findings.js` |
| Overview tab (status cards + all findings) | `src/popup/views/overview.js` |
| About tab | `src/popup/views/about.js` |
| SPA URL changes, bfcache restore, prerender deferral | `page_injector.js` → `hookHistory`, `pageshow` handler, `document.prerendering` gate |
| Re-injection / REPROBE snapshot | `page_injector.js` → `snapshot`, `reprobeApis`; `service_worker.js` → `ensureInjected`, `reprobe` |

## Tests & tooling

| Feature | Files |
|---|---|
| Unit tests (decoders, checks, models, findings, export, contract) | `test/unit/*.test.js` |
| Oracle TC vectors (@iabtcf/core), GVL/cmp-list fixtures | `test/fixtures/data/*.json` |
| E2E harness (CDP over pipe, no deps) + static fixture server | `test/e2e/cdp.js`, `test/e2e/serve.js` |
| E2E scenarios and assertions | `test/e2e/run_e2e.js` |
| Fixture pages + fake gtag.js / fake CMP+GPP+UET | `test/fixtures/*.html`, `test/fixtures/js/fake-gtag.js`, `test/fixtures/js/fake-cmp.js` |
| Static checks, store packaging | `scripts/check.sh`, `scripts/package.sh` |
