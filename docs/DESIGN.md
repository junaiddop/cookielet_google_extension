> Status: implemented in v2.0.0 (2026-09-03). §13 addenda override earlier sections where they conflict; the tab record adds documentId/instrumented/rev, TCF pingHistory/storage/viaPostMessage, GPP commands/sections/errors, UET kind/config and a `URL_CHANGE` event (see src/background/state.js).

# Cookielet Consent Inspector v2 — Design & module contracts

This document is the **single source of truth** for the v2 rebuild. Implementation agents
must follow the file layout, message names, state shape and function signatures here exactly,
so that independently written modules fit together. No build step, no runtime dependencies.

## 1. Goals

Production-ready MV3 Chrome extension that inspects **any** page for:

1. **Google Consent Mode v2** — dataLayer `consent default/update` capture (ours), Google's
   own internal state `google_tag_data.ics` (UniConsent), tag-ordering diagnostics, network
   `gcs`/`gcd`/`npa`/`dma`/`dma_cps`/`gdpr`/`gdpr_consent`/`tcfd` (ours + extras).
2. **IAB TCF v2.2** — full CMP-Validator parity: cmp-list + GVL lookups, 13 technical checks
   (10 automated), 32 manual policy checks with persisted answers, CMP & API command check,
   TC string check (via API + manual paste), purposes/features/vendors with GVL names,
   publisher restrictions, Google Additional Consent, CSV/JSON report, complaint link.
3. **IAB GPP** — ping/events, header decode (version + section ids), JSON copy.
4. **Microsoft UET** consent (`uetq`) + bat.bing.com tag detection.
5. Overview with ranked findings, badge OK/!/ERR, side panel, per-tab state.

**Must keep (user's specialty)** on the Google Consent Mode tab, verbatim section titles:
`Consent Mode Signals`, `Consent Events (dataLayer)` with empty text
`No consent default/update calls captured.`, and `Network Signals (gcs / gcd)` with empty
text `No Google tag requests captured yet.`.

## 2. File layout (final)

```
cookielet_google_extension/
├── manifest.json                      # MV3, ESM service worker, MAIN-world content script
├── package.json                       # scripts only: test, e2e, package, check
├── README.md · CHANGELOG.md
├── icons/icon{16,48,128}.png
├── _locales/en/messages.json          # extName, extDescription
├── src/
│   ├── shared/                        # pure ESM libraries (no chrome.* except where noted)
│   │   ├── constants.js
│   │   ├── util/dom.js                # h(), clear(), fmtTime(), fmtDate(), copyButton()
│   │   ├── util/csv.js                # toCsv(rows)
│   │   ├── tcf/tc_decoder.js          # decode(tcString) (existing, extended)
│   │   ├── tcf/ac_parser.js           # parseAddtlConsent()
│   │   ├── tcf/gvl.js                 # trimGvl(), trimCmpList(), fetchGvl*() (fetch only)
│   │   ├── tcf/technical_checks.js    # runTechnicalChecks()
│   │   ├── tcf/policy_checks.js       # POLICY_CHECKS (data), summarize()
│   │   ├── tcf/tcf_model.js           # buildTcfModel(tab, gvl, cmpList)
│   │   ├── gcm/gcd_parser.js          # parseGcd(), parseGcs(), describeSignal() (existing+)
│   │   ├── gcm/gcm_model.js           # buildGcmModel(tab)
│   │   ├── gcm/gcm_checks.js          # runGcmChecks(tab, gcm)
│   │   ├── gpp/gpp_header.js          # decodeGppHeader(gppString)
│   │   ├── uet/uet_model.js           # buildUetModel(tab)
│   │   ├── checks/findings.js         # collect + rank findings; badgeStatus()
│   │   └── report/export.js           # buildJsonReport(), buildCsvRows(), download()
│   ├── data/tcf_checks.json           # technical + policy check texts (from IAB structure.json)
│   ├── background/
│   │   ├── service_worker.js          # entry: wires state, network, gvl, messages, badge
│   │   ├── state.js                   # blankTab(), TabStore (hydrate/persist/apply), caps
│   │   ├── network.js                 # webRequest observers → store.recordNetwork()
│   │   └── gvl_service.js             # cached GVL / cmp-list / archived GVL (storage.local)
│   ├── content/
│   │   ├── page_injector.js           # MAIN world IIFE (classic script, no imports)
│   │   └── content_script.js          # isolated relay IIFE (classic script)
│   └── popup/
│       ├── popup.html · popup.css
│       ├── main.js                    # boot, tabs, refresh loop, side panel, exports
│       ├── components.js              # statusCard, findingsList, section(), kvGrid, table
│       └── views/{overview,gcm,tcf,gpp,uet,about}.js
├── test/
│   ├── unit/*.test.js                 # node --test (Node 18+)
│   ├── fixtures/*.html + fixtures/js/ # e2e pages (fake gtag/GTM, fake CMP, fake GPP, uetq)
│   └── e2e/{serve.js,run_e2e.py}      # static server + Playwright (python) runner
├── scripts/{package.sh,check.sh}      # zip for store (excludes docs/test/scripts), lint
└── docs/{DESIGN.md,ARCHITECTURE.md,FEATURE-PARITY.md,reference-samples/}
```

Classic-script constraint: `content/*.js` cannot import. Everything else is ESM
(`"type": "module"` on the worker; `<script type="module">` in popup.html).

## 3. Runtime topology

```
MAIN world (page)                ISOLATED world              service worker            popup / side panel
page_injector.js  --postMessage-->  content_script.js  --runtime.sendMessage-->  state.js  <--GET_TAB_DATA--  main.js + views
  hooks dataLayer/uetq                relay + handshake        network.js (webRequest)           shared/* checks
  probes __tcfapi/__gpp/ics       <--CMD (re-probe)--       gvl_service.js (fetch+cache)  <--GET_GVL, SET_MANUAL--
```

Handshake (unchanged): injector posts `READY`, relay posts `HELLO`; injector buffers until HELLO.
Message envelope page→relay: `{source:'COOKIELET_CMP_DEBUGGER', payload:{type, data, timestamp}}`.
Relay→worker: `{action:'RECORD', payload}`. Worker→relay→injector command:
`{action:'PAGE_CMD', cmd:'REPROBE'}` → relay posts `{source:'COOKIELET_CMP_DEBUGGER_CMD', cmd}`.

## 4. Injector event types (`payload.type`) and `data`

| type | when | data |
|---|---|---|
| `PAGE_INIT` | once at install | `{url, readyState, title}` |
| `DIAGNOSTICS` | every 500 ms tick, only when JSON changed; stop after 60 s idle-unchanged **but** keep a slow 2 s tick for 5 min | see §4.1 |
| `CONSENT_MODE_EVENT` | dataLayer push of `consent default/update` or `set` flags | `{command:'default'\|'update'\|'set', params:{…}, dlIndex}` |
| `DL_EVENT` | dataLayer push of `config`/`js`/`event` entries relevant to ordering | `{kind:'config'\|'gtm.js'\|'gtm.dom'\|'gtm.load'\|'gtm.init'\|'gtm.init_consent', tagId?, dlIndex}` |
| `GCM_ICS` | `google_tag_data.ics` snapshot when changed | `{entries:{[signal]:{default:bool\|null, update:bool\|null, declare?:bool, region?:any}}, usedDefault, usedUpdate, usedDeclare, usedSet, wasSetLate, waitPeriodTimedOut, active, accessedAny, accessedDefault}` (missing → null) |
| `TCF_API_FOUND` | first time `typeof __tcfapi==='function'` or locator frame seen | `{api:bool, locator:bool}` |
| `TCF_PING` | ping callback | pingData |
| `TCF_DATA` | every addEventListener callback with success | tcData (listenerId included) |
| `TCF_COMMAND` | each probe result | `{command, ok:bool, note?}` for `ping,getTCData,addEventListener,removeEventListener,getInAppTCData,getVendorList` (getVendorList `note` = `{vendorListVersion,tcfPolicyVersion,vendorCount}` only, never the full list) |
| `TCF_ERROR` | thrown/failed calls | `{where, message}` |
| `GPP_API_FOUND` | first time `__gpp` fn or `__gppLocator` frame | `{api:bool, locator:bool}` |
| `GPP_PING` | each ping (polled 1 s until `signalStatus==='ready'`, max 60) | pingData |
| `GPP_EVENT` | addEventListener callbacks | `{eventName, listenerId, data, pingData}` |
| `GPP_DATA` | legacy getGPPData | data |
| `UET_API_FOUND` | `window.uetq` or `window.UET` seen | `{api:true}` |
| `UET_EVENT` | uetq push of `consent default/update` or `uetConfig.consent` seen | `{command, params:{ad_storage}}` |

### 4.1 `DIAGNOSTICS` data
```
{ tcfApi, tcfLocator, gppApi, gppLocator, gtagFn, dataLayer, dataLayerLength,
  gtagData, gcmActive, tagIds:[{id, source:'dataLayer'|'tidr'|'gtm'}], adsActive, gtagLoaded, gtmLoaded,
  gtmContainers:[...], consentDefaultDlIndex, gtmJsDlIndex, gtmLoadDlIndex,
  cmp: {name, hint} | null, uetq }
```
`cmp` fingerprint table (first match wins): Cookielet (`window.CMP && typeof CMP.getTCString==='function'` or `document.querySelector('[id^="cl-t1"],[class*="cl-t1"]')`),
Cookiebot (`window.Cookiebot`), OneTrust (`window.OneTrust`), Usercentrics (`window.UC_UI`), Didomi (`window.Didomi`),
Sourcepoint (`window._sp_`), CookieYes (`window.CookieYes` or `ckyConsent`), Iubenda (`window._iub`), UniConsent (`window.__unicapi`),
Quantcast (`window.__qcCmpApi` or `qc-cmp2-container`), TrustArc (`window.truste`), Osano (`window.Osano`), Termly (`window.Termly`),
CookieScript (`window.CookieScript`), Consentmanager (`window.__cmp && cmp_id`), Axeptio (`window.axeptio`), Klaro (`window.klaro`).

## 5. Tab state (service worker, persisted to `chrome.storage.session` key `tab_<id>`)

```js
{
  v: 2, pageUrl, title, startedAt, injectedManually, readyStateAtInject,
  diagnostics: null | <DIAGNOSTICS data> ,  diagnosticsAt,
  gcm: { events: [{data, timestamp}] (cap 200), dl: [{data, timestamp}] (cap 200),
         ics: null | {data, timestamp}, icsHistory: [] (cap 20) },
  tcf: { apiFound:false, locatorFound:false, ping:null|{data,timestamp}, data:null|{data,timestamp},
         history: [{eventStatus, cmpStatus, tcString, timestamp}] (cap 50),
         commands: { ping:null, getTCData:null, addEventListener:null, removeEventListener:null,
                     getInAppTCData:null, getVendorList:null }  // null | {ok, note, timestamp}
         errors: [] (cap 50) },
  gpp:  { apiFound, locatorFound, ping:null, events:[] (cap 100), data:null },
  uet:  { apiFound:false, events:[] (cap 50), tagRequests:[] (cap 50) },
  network: { signals: [] (cap 300), firstTagLoadAt:null, firstCollectAt:null }
}
```
Network signal record: `{host, path(≤120), type:'tag_load'|'collect'|'bing_tag'|'bing_hit'|'other', gcs, gcd, npa, dma, dma_cps, gdpr, gdpr_consent, tcfd, asc, timestamp}`.

`PAGE_INIT` reset rule (keep): reset only when `readyState==='loading'` (fresh document) or no
record; otherwise merge (late/manual injection). All RECORD handling is **serialized** via one
promise chain (keeps the existing bug fix).

## 6. Worker messages (`chrome.runtime.sendMessage`)

| action | from | payload | response |
|---|---|---|---|
| `RECORD` | content | `{type,data,timestamp}` (sender.tab.id) | `{ok:true}` |
| `GET_TAB_DATA` | popup | `{tabId}` | tab record or `null` |
| `ENSURE_INJECTED` | popup | `{tabId}` | `{ok, error?}` |
| `REPROBE` | popup | `{tabId}` | `{ok}` — forwards `PAGE_CMD REPROBE` to the tab via `chrome.tabs.sendMessage` |
| `CLEAR_TAB` | popup | `{tabId}` | `{ok}` |
| `GET_GVL` | popup | `{version?: number, force?: bool}` | `{gvl: trimmed latest, cmpList: trimmed, versioned?: trimmed GVL for `version` (only if ≠ latest), fetchedAt, error?}` |
| `GET_MANUAL` | popup | `{host}` | `{responses: {[checkId]: true|false|null}}` |
| `SET_MANUAL` | popup | `{host, checkId, value}` | `{ok}` |

GVL/cmp-list cache: `chrome.storage.local` keys `gvl_latest`, `cmp_list`, `gvl_v<N>`, each
`{fetchedAt, data}`; TTL 24 h (GVL publishes weekly); archived versions never expire.
Fetch URLs: `https://vendor-list.consensu.org/v3/vendor-list.json`,
`https://vendor-list.consensu.org/v3/archives/vendor-list-v<N>.json`,
`https://cmp-list.consensu.org/v2/cmp-list.json`. Errors are returned, never thrown to the popup.

Trimmed GVL shape (`trimGvl(raw)`):
```
{ vendorListVersion, tcfPolicyVersion, gvlSpecificationVersion, lastUpdated, maxVendorId,
  purposes:{id:{id,name}}, specialPurposes:{…}, features:{…}, specialFeatures:{…},
  vendors:{id:{id,name,deletedDate?, purposes:[], legIntPurposes:[], flexiblePurposes:[], specialPurposes:[], features:[], specialFeatures:[]}} }
```
Trimmed cmp-list (`trimCmpList(raw)`): `{ lastUpdated, cmps:{id:{id,name,isCommercial}} }`.

Manual answers: `chrome.storage.local` key `manual_<host>` → `{[checkId]: true|false}`.

## 7. Shared library contracts (ESM)

### `shared/constants.js`
`MSG = {RECORD, GET_TAB_DATA, ENSURE_INJECTED, REPROBE, CLEAR_TAB, GET_GVL, GET_MANUAL, SET_MANUAL, PAGE_CMD}`,
`EVT = {…all §4 types…}`, `GCM_SIGNALS` (7), `GCM_V2_REQUIRED` (4), `CAPS`, `COOKIELET_CMP_ID = 503`,
`URLS = {GVL_LATEST, GVL_ARCHIVE(v), CMP_LIST, COMPLAINT_FORM, TCF_POLICY, GCM_GUIDE}`, `TCF_MAX_AGE_MS`.

### `shared/tcf/tc_decoder.js`
`decode(tcString) → {…core fields…, disclosedVendors?, allowedVendors? (segment 2), publisherTC?, segments:[{type, raw}], byteSize, error?}`.
Existing fields kept: version, created, lastUpdated (ISO), cmpId, cmpVersion, consentScreen,
consentLanguage, vendorListVersion, tcfPolicyVersion, isServiceSpecific, useNonStandardTexts,
specialFeatureOptIns[], purposeConsents[], purposeLegitimateInterests[], purposeOneTreatment,
publisherCC, vendorConsents[], maxVendorIdConsent, vendorLegitimateInterests[], maxVendorIdLI,
publisherRestrictions[{purposeId, restrictionType, vendors[]}]. Add `createdMs`, `lastUpdatedMs`
(numbers) and `hasDisclosedVendorsSegment` (true iff a segment of type 1 decoded).
Exports also `PURPOSE_NAMES`, `SPECIAL_FEATURE_NAMES`, `RESTRICTION_TYPES`, `MAX_AGE_MS`, `segmentTypeOf(segStr)`.

### `shared/tcf/ac_parser.js`
`parseAddtlConsent(ac) → null | {raw, valid, version:1|2|null, consented:[], disclosed:[]}`.

### `shared/tcf/technical_checks.js`
```js
runTechnicalChecks({ tab, decoded, tcData, ping, cmpList, gvlLatest, gvlForVersion }) →
  { results: { technicalComplianceCheck_4: true|false|null, … _13 }, details: { [id]: string } }
```
Semantics (null = could not evaluate):
- 4: `tab.tcf.commands.ping?.ok && addEventListener?.ok && removeEventListener?.ok` (null if any command not yet probed)
- 5: `cmpList.cmps[cmpId]` exists (cmpId from ping ?? tcData ?? decoded)
- 6: `0 < decoded.vendorListVersion <= gvlLatest.vendorListVersion`
- 7: `decoded.vendorListVersion >= gvlLatest.vendorListVersion - 1`
- 8: `maxVendorIdConsent <= gvlLatest.maxVendorId && maxVendorIdLI <= gvlLatest.maxVendorId`
- 9: none of purposes 1,3,4,5,6 in `purposeLegitimateInterests` (from decoded string)
- 10: `createdMs === lastUpdatedMs`
- 11: both timestamps have UTC hours, minutes and seconds all zero (day precision). Detail text notes when only seconds are zero (IAB validator leniency).
- 12: for GVL `g = gvlForVersion ?? gvlLatest`: every id in `1..g.maxVendorId` that is missing or has `deletedDate` is absent from `vendorConsents` and `vendorLegitimateInterests`
- 13: `decoded.hasDisclosedVendorsSegment`
Each check needs its inputs; when a required input (GVL, cmp-list, TC string) is absent → null with detail "needs …".

### `shared/tcf/policy_checks.js`
Loads `data/tcf_checks.json` (importer passes the parsed JSON in; the module is pure):
`getSections(data) → {technical:[check], policy:[check], cmpApi:[subsection]}`,
`summarize(checks, automatedResults, manualResponses) → {passed, failed, todo, label}`.
Check shape: `{number, id, text, automated, manualSteps, policyReference}` (policyReference plain text, paragraphs joined by `\n\n`; HTML tags stripped at data-prep time).

### `shared/tcf/tcf_model.js`
`buildTcfModel(tab, {gvl, gvlForVersion, cmpList}) → { present, apiFound, locatorFound, ping, tcData, tcString, decoded, cmpId, cmpName, cmpRegistered, cmpIsCommercial, ac, counts:{purposeConsents, purposeLI, specialFeatures, vendorConsents, vendorLI, vendorsDisclosed}, technical:{results, details}, errors, history }`.

### `shared/gcm/gcd_parser.js`
Keep `parseGcd`, `parseGcs`, `LETTER_MAP`, `SIGNAL_ORDER`; add `describeSignal(letter) → 'Granted by default, denied after update' | … | 'Signal not set'` (UniConsent labels), `parseGcdWithLabels(gcd)`.

### `shared/gcm/gcm_model.js`
`buildGcmModel(tab) → { defaults, updates, setFlags, firstDefaultAt, firstUpdateAt, waitForUpdate, regions, defaultCount, updateCount, events, ics (latest data|null), icsFlags:{usedDefault, usedUpdate, wasSetLate, waitPeriodTimedOut, active}, icsSignals:{[signal]:{default:'granted'|'denied'|null, update:…}}, dl:{consentDefaultIndex, gtmJsIndex, gtmLoadIndex, firstConfigIndex}, tagIds, googleTagsSeen, adsActive, latestGcd:parsed|null, latestGcs }`.
`googleTagsSeen` = network tag_load/collect seen OR diagnostics.gtagData OR any tagIds OR any consent events.

### `shared/gcm/gcm_checks.js`
`runGcmChecks(tab, gcm) → finding[]` where `finding = {id, sev:'err'|'warn'|'info', area, tab:'gcm', title, msg, link?}`.
Rules (ids stable, used by tests):
- `gcm.no_consent_mode` err: googleTagsSeen && no default && no update ("Google tags are loaded but Google Consent Mode is not active…")
- `gcm.update_without_default` err
- `gcm.default_after_tag_load` err: firstDefaultAt > firstTagLoadAt (network) **or** dl.consentDefaultIndex > dl.gtmJsIndex (dataLayer) **or** icsFlags.wasSetLate === true
- `gcm.hit_before_default` err: firstCollectAt < firstDefaultAt
- `gcm.ics_no_default` err: icsFlags.usedDefault === false while googleTagsSeen
- `gcm.ads_without_gcm` warn: adsActive && ics present && !icsFlags.active
- `gcm.v2_signals_missing` warn (lists missing of the 4)
- `gcm.wait_for_update` info; `gcm.region` info; `gcm.ads_data_redaction` info; `gcm.url_passthrough` info (only if ad_storage denied and not set)
- `gcm.wait_period_timed_out` warn: icsFlags.waitPeriodTimedOut === true ("update arrived after wait_for_update expired")
- `gcm.retroactive_grant` warn (existing rule)
- `gcm.dl_vs_ics_mismatch` warn: latest dataLayer effective state ≠ ics effective state for any of the 4 required signals
- `gcm.gdpr_consent_mismatch` warn: a network `gdpr_consent` value ≠ current CMP tcString
- `gcm.gcd_mismatch` info: latest `gcd` effective state ≠ ics/dataLayer effective state

### `shared/gpp/gpp_header.js`
`decodeGppHeader(gppString) → {valid, version, sectionIds:[], sections:[{id,name}], error?}` — header
segment: type(6 bits)=3, version(6), then Fibonacci-range encoded section ids. Section names:
2 TCF EU v2, 3 GPP header? no — use IAB table: 1 tcfeuv1, 2 tcfeuv2, 3 header, 4 gpp signal integrity, 5 tcfcav1, 6 uspv1, 7 usnat, 8 usca, 9 usva, 10 usco, 11 usut, 12 usct, 13 usfl, 14 usmt, 15 usor, 16 ustx, 17 usde, 18 usia, 19 usne, 20 usnh, 21 usnj, 22 ustn.

### `shared/uet/uet_model.js`
`buildUetModel(tab) → { apiFound, tagSeen (bing requests), adStorage:'granted'|'denied'|null, events, latestAsc }`.

### `shared/checks/findings.js`
`collectFindings(tab, models) → finding[]` merging gcm + tcf + gpp + uet findings, sorted err→warn→info.
TCF findings (ids): `tcf.not_loaded`, `tcf.status_error`, `tcf.api_errors`, `tcf.decode_failed`, `tcf.version`,
`tcf.cmp_unregistered` (from cmp-list; if cmp-list unavailable fall back to cmpId<2), `tcf.expired_13m`,
`tcf.created_future`, `tcf.policy_version`, `tcf.no_tcstring_gdpr`, `tcf.technical_failed` (one per failed automated check 4–13, msg = check text),
`tcf.ac_invalid`, `tcf.ac_v1`, `tcf.locator_missing` (api but no `__tcfapiLocator` frame) , `tcf.required_command_missing`.
GPP: `gpp.not_ready` info. UET: `uet.no_consent` warn (bing tag seen, no ad_storage signal).
`badgeStatus(findings, models) → 'error'|'warning'|'pass'|'none'`.

### `shared/report/export.js`
`buildJsonReport({tab, models, findings, manual}) → object`; `buildCsvRows(...) → string[][]`
(IAB layout: `Id, Compliance Check Name, Result` with SUMMARY / TECHNICAL / POLICY / CMP+API / TC STRING sections);
`download(filename, mime, text)` (anchor + object URL, revoke after click).

## 8. Popup

`popup.html`: header (logo, title, `Side panel` button, status badge), tabs
`Overview · Google Consent Mode · IAB TCF 2.2 · IAB GPP · Microsoft UET · About`, footer (page url,
`Cookielet · CMP ID 503`, buttons `Export JSON`, `Export CSV`, `Re-probe`, `Clear`).
Each view exports `render(ctx)` with `ctx = {tab, models:{gcm,tcf,gpp,uet}, findings, gvlState, manual, host, actions}`.
All untrusted text via `textContent` (never innerHTML). Views own their DOM subtree (`#view-<name>`).

Overview cards (order): Google Consent Mode · Consent Mode Default · Consent Mode v2 Signals ·
Tags Loading Order · CMP Detected (fingerprint) · IAB TCF API · TC String · IAB GPP API ·
Google Additional Consent · Microsoft UET. Then findings list.

GCM view order: status strip (UniConsent-style: CMP Installed, Google Consent Mode, Consent Mode Default, Tags Loading Order),
findings, **Consent Mode Signals** (table Parameter / Default / Updated / *Google state* (ics default→update)),
`google_tag_data.ics` flags row (usedDefault, usedUpdate, wasSetLate, waitPeriodTimedOut, active),
**Consent Events (dataLayer)** (kept), **Network Signals (gcs / gcd)** (kept; add columns npa / dma / gdpr_consent-present),
**Signal Breakdown** (latest gcd → 4 rows with `describeSignal` labels), Detected tags (ids + sources).

TCF view order: findings; Summary card (CMP Found · CMP Id · CMP Version · TCF API Version · TCF Policy Version · GDPR Applies · Event Status · CMP Status · Display Status; counts lines; "Technical Compliance Checks passed: x failed: y to do: z"; "Policy Compliance Checks passed…");
collapsibles: Technical Compliance Checks (13 rows: number, text, result icon; manual rows get Pass/Fail/Reset buttons; ℹ toggles detail with manual steps + policy reference),
Policy Compliance Checks (32 rows, same controls), CMP and TCF API check (3 sub-groups),
TC String Check (API string + bytes + copy + decode bullet list; manual paste textarea → decode + compare),
Purposes (Consent), Purposes (Legitimate Interest) (1,3,4,5,6 marked "n/a for LI"), Special Features,
Vendors (Consent) / (Legitimate Interest) / (Disclosed) — rows `id · name` from GVL (fallback id only), Publisher Restrictions,
Google Additional Consent (ATP), TC data history, `__tcfapi` errors. Footer links: File a complaint, GVL v<N> fetched <time> · Refresh.
Not-found state text: `No CMP API found on this webpage.`

Refresh: `chrome.storage.session.onChanged` for `tab_<id>` + 2 s interval fallback; active tab re-queried each tick.
Guard: if active tab url starts with `chrome://`, `chrome-extension://`, `edge://`, `about:`, or is the Web Store → show
"Navigate to a website and reopen this panel to check consent data." and skip injection.

## 9. Badge (worker)
Computed after every state change with `badgeStatus`: `error`→`ERR` #d93025, `warning`→`!` #f9ab00,
`pass`→`OK` #1e8e3e, `none`→``. Set per tabId.

## 10. Manifest
```json
{ "manifest_version": 3, "name": "__MSG_extName__", "description": "__MSG_extDescription__",
  "default_locale": "en", "version": "2.0.0", "minimum_chrome_version": "116",
  "permissions": ["activeTab","scripting","storage","webRequest","sidePanel"],
  "host_permissions": ["<all_urls>"],
  "background": {"service_worker": "src/background/service_worker.js", "type": "module"},
  "action": {...}, "side_panel": {"default_path": "src/popup/popup.html"},
  "content_scripts": [ {isolated relay @document_start}, {page_injector @document_start, "world":"MAIN"} ] }
```
No `web_accessible_resources`, no remote code, CSP default.

## 11. Tests
- Unit (`node --test test/unit`): tc_decoder (vectors incl. range vendors, segments 1/2/3, byteSize; oracle vs `@iabtcf/core` from `../cookielet_popup_builder/builder/node_modules` when resolvable, skipped otherwise), ac_parser, gcd_parser (+labels), gpp_header, technical_checks (fixture GVL/cmp-list), gcm_checks (scenarios: correct, late default, no default, ics wasSetLate, mismatch), findings/badge, export csv.
- E2E (`python3 test/e2e/run_e2e.py`): serves `test/fixtures` on 127.0.0.1:8899, launches Playwright Chromium (`launch_persistent_context`, `channel='chromium'`, headless) with `--load-extension`, opens each fixture, waits, reads `chrome.storage.session` from the extension service worker (`context.service_workers`), asserts per-fixture expectations (events captured, ordering verdicts, TCF probes, GPP, UET). Fixtures: `gcm-correct.html`, `gcm-late-default.html`, `gcm-no-default.html`, `tcf-cmp.html` (fake CMP: ping/getTCData/addEventListener/removeEventListener/getVendorList, locator iframe, GPP stub, uetq), `no-cmp.html`. Fake `gtag.js` in `fixtures/js/` sets `google_tag_data.ics` realistically (entries/usedDefault/usedUpdate/wasSetLate) and pushes `gtm.js`/`gtm.load`.

## 12. Non-goals / limits (documented in README)
Top frame only; POST bodies not parsed; custom-named dataLayers hooked only when discoverable via `google_tag_manager[*].dataLayer.name`; manual policy checks are human judgement.

---

## 13. Addenda from the adversarial analysis (binding; override earlier sections where they conflict)

### 13.1 Framework versions and wording
- The TC string spec is now **TCF v2.3** (released 19 Jun 2025, enforced 1 Mar 2026): a TC string **must** contain the Core + **DisclosedVendors** segments; PublisherTC is optional; `IsServiceSpecific` must be 1; segment type 2 (AllowedVendors) is legacy (decoded tolerantly, never required). The CMP API remains **v2.2** (version argument `2`). UI wording: tab label `IAB TCF`, summary line `TCF API v2.2 · TC string v2.3`.
- Findings added: `tcf.missing_disclosed_vendors` (**err**, when `decoded && !hasDisclosedVendorsSegment && gdprApplies !== false`), `tcf.not_service_specific` (**err**), `tcf.cmp_deleted` (**err**, cmp-list `deletedDate` in the past), `tcf.policy_version` (**warn**: `decoded.tcfPolicyVersion !== gvlLatest.tcfPolicyVersion`, fallback constant 5; also `info` when ping/tcData policy version ≠ decoded), `tcf.gvl_version_mismatch` (**info**: `ping.gvlVersion !== decoded.vendorListVersion`), `tcf.ac_duplicate_ids` (**info**), `tcf.stub_missing` (**warn**: a CMP is fingerprinted but neither `__tcfapi` nor the locator frame exists), `tcf.restriction_type_undefined` (**warn**, restrictionType 3), `tcf.storage_mismatch` (**warn**, see 13.4).
- `tcf.expired_13m` is downgraded to **warn** and reworded: "TC string lastUpdated is older than 13 months — TCF Policies require reminding users of their choices at least every 13 months" (the 13-month rule is a policy reminder, not a string-validity rule).
- `tcf.cmp_unregistered`: use `cmpStatus(cmpList, cmpId)` from `shared/tcf/gvl.js`; when the cmp-list is unavailable fall back to `cmpId < 2`.
- Names fallback tables now match GVL v3 (`SPECIAL_FEATURE_NAMES[2]`, `SPECIAL_PURPOSE_NAMES`, `FEATURE_NAMES`); prefer GVL names when loaded.
- cmp-list canonical URL is `https://cmplist.consensu.org/v2/cmp-list.json` with the hyphenated host as fallback (both in `URLS`).

### 13.2 Google Additional Consent
- Grammar: `^2~(ids)?~dv(\.(ids)?)?$` and `^1~(ids)?$`; `parseAddtlConsent` returns `duplicates` (ids in both parts). `tcf.ac_invalid` only when the grammar fails; `tcf.ac_v1` info wording: "Additional Consent v2 has been the standard since December 2023; v1 strings cannot indicate whether transparency was established".
- `gvl_service` also caches Google's ATP provider list (`URLS.ATP_LIST`, CSV `provider_id,provider_name,policy_url,domains`, 24 h TTL, storage key `atp_list` → `{fetchedAt, data:{[id]:{name, policyUrl}}}`); `GET_GVL` returns `atp` alongside `gvl`/`cmpList`. The TCF view renders ATP rows as `id · name`; unknown ids are labelled "not on Google's ATP list". Parse CSV with a proper quoted-field parser (names contain commas).

### 13.3 Technical checks (parity notes)
- #4 is `null` until all three required commands were probed (deliberate improvement over the validator's plain boolean).
- #5 fails for CMPs missing from the list **or** with a past `deletedDate`.
- #6/#7 use the TC string's `vendorListVersion`, else `ping.gvlVersion` (validator parity); #8 compares the string's MaxVendorId fields with the highest numeric vendor id of the **latest** GVL; #9 uses the decoded string (the validator reads `tcData.purpose.legitimateInterests`; both are surfaced — if they disagree emit `tcf.api_string_mismatch` warn); #11 = both timestamps at UTC midnight (`ms % 86400000 === 0`), detail notes when only the validator's local-seconds leniency would pass; #12 uses the archived GVL matching the string's version when available, else latest; #13 detail states the v2.3 mandate.
- When `gdprApplies === false`: TCData legitimately carries only `gdprApplies, tcfPolicyVersion, cmpId, cmpVersion` — `TCF_DATA` must still be recorded (do **not** copy the validator's `typeof tcString === 'string'` acceptance test), the Summary comes from ping, technical checks 6–13 report `null` with detail "GDPR does not apply", the TC String Check and list sections render `not applicable`.
- Summary count lines (validator wording): "Number of purposes the user has expressed consent for: N" (or "The user has expressed consent for all purposes" / "The user rejected consent for all purposes"), "Number of purposes the user objected to the use of legitimate interest: N" (or "The user did not object…" / "The user objected…"), "Number of special features the user has expressed consent for: N" (or "…expressed consent for all special features" / "…rejected consent for any special features"), "Number of vendors the user has expressed consent for: N", "Number of vendors the user agreed to the use of legitimate interest: N", "Number of vendors disclosed to the user: N". Counts come from the decoded string; the LI objection count = GVL purposes not in {1,3,4,5,6} without an LI signal.
- Summary status lines: `Technical Compliance Checks passed: X, failed: Y, to do: Z` and `Policy Compliance Checks passed: X, failed: Y, to do: Z` (UI, comma-separated); the CSV uses the comma-less form.
- `CMP Found` states: name from cmp-list; `NOT FOUND` when the id is absent; `CMP Loading…` while neither ping nor tcData exists; blank when the cmp-list failed to load (show the fetch error inline).

### 13.4 Injector additions
- **IABTCF_* localStorage snapshot** (`TCF_STORAGE` event, on change, ≤ 1/s): keys `IABTCF_CmpSdkID, IABTCF_CmpSdkVersion, IABTCF_PolicyVersion, IABTCF_gdprApplies, IABTCF_PublisherCC, IABTCF_PurposeOneTreatment, IABTCF_UseNonStandardTexts, IABTCF_TCString, IABTCF_VendorConsents, IABTCF_VendorLegitimateInterests, IABTCF_DisclosedVendors, IABTCF_PurposeConsents, IABTCF_PurposeLegitimateInterests, IABTCF_SpecialFeaturesOptIns, IABTCF_PublisherConsent, IABTCF_PublisherLegitimateInterests, IABTCF_PublisherCustomPurposesConsents, IABTCF_PublisherCustomPurposesLegitimateInterests, IABTCF_AddtlConsent` (+ any `IABTCF_PublisherRestrictions*`), plus the `euconsent-v2` cookie value when readable. State: `tab.tcf.storage = {data, timestamp}`. Finding `tcf.storage_mismatch` (warn) when `IABTCF_TCString` ≠ API `tcString` or `IABTCF_AddtlConsent` ≠ `addtlConsent`.
- **GPP 1.1 probes**: `ping` (poll 1 s until `signalStatus === 'ready'`, max 60; the first result is recorded immediately whatever its status), `addEventListener` + `removeEventListener(listenerId)` recorded in `tab.gpp.commands`, `hasSection(prefix)` for every `supportedAPIs` entry (`'2:tcfeuv2'` → prefix after the colon) recorded as `tab.gpp.sections[prefix] = bool`, `getGPPData` legacy fallback only. Findings: `gpp.not_ready` (info), `gpp.no_applicable_section` (info, `applicableSections` is `[-1]` or `[0]`/`0` after `cmpStatus==='loaded'`), `gpp.header_mismatch` (warn, header section ids ≠ `applicableSections`/segment count).
- **uetq**: guard `window.uetq` with an accessor (like `dataLayer`), re-wrap `push` whenever the UET loader replaces the array with its object; read `uetq.uetConfig.consent.adStorageAllowed` (boolean → granted/denied) when present; replay existing array entries; record `('consent','default'|'update',{ad_storage})` pushes.
- **Silence**: `page_injector.js` and `content_script.js` write nothing to the page console. The worker and popup log only when `chrome.storage.local.debug === true` (a `log()` helper that checks a cached flag). Errors surface as `TCF_ERROR` / `DIAGNOSTICS` data.
- Diagnostics derivations (UniConsent parity): `gtagLoaded` = any dataLayer `['config','G-…']`; `adsActive` = dataLayer `['config','AW-…']` or a `google_tag_data.tidr.container` key starting `AW-`; `gtagData` = `!!window.google_tag_data`; `gcmActive` = `!!google_tag_data.ics.active`; `gtmLoaded` = `window.google_tag_manager` has a `GTM-…` key or dataLayer has `{event:'gtm.js'}`; `tagIds` union of dataLayer config ids, `google_tag_data.tidr.container/destination` keys and `google_tag_manager` keys matching `/^(G|AW|GTM|DC|UA|MC|GT)-/`. Ordering: `consentDefaultDlIndex`, `gtmJsDlIndex`, `gtmLoadDlIndex`, `firstConfigDlIndex` are array indices in `dataLayer` (replayed entries included).
- `GCM_ICS` is re-sent whenever **either** the entries **or** the flags change (the sample missed flag-only flips).
- The `google_tag_data.ics.entries[signal]` values are booleans (`default`, `update`); convert to `'granted'|'denied'|null` in `gcm_model`, never to the strings "true"/"false".

### 13.5 Network capture
- Match **any host** whose query string carries `gcs` or `gcd` (server-side GTM first-party endpoints), plus the Google/DoubleClick/Bing host filters for tag loads and hits without those params. Record `host`; ignore `tabId < 0`.
- Bing/UET tag detection: `https://bat.bing.com/action/*`, `https://commerce.bing.com/cst/0*`, `https://mtag.microsoft.com/tags/*` → `type:'bing_hit'` (+ `asc` param); `bat.js` loads → `bing_tag`.
- Record only the first 120 chars of the path and never the full query string (privacy).

### 13.6 Popup copy and semantics (UniConsent parity, adapted)
- GCM status banner (top of the GCM view and the Overview): `Passed: Consent Mode and CMP are correctly set. Everything is functioning as expected.` · `Error: {n} issue{s} found with your Consent Mode implementation.` · `Warning: {n} warning{s} found. Review the details below.` · `Info: No Google tags (gtag.js / GTM / Google Ads) detected on this page.`
- GCM cards: `CMP Installed` (shown when a CMP is fingerprinted or `ics.usedUpdate === true`; text = CMP name or `Active`), `Google Consent Mode` (`Correct` when `gcmActive || ics.usedDefault === true`, else `Warning`; only when Google tags seen), `Consent Mode Default` (`Active` / `Not found` / `-`), `Tags Loading Order` (`Wrong` when `wasSetLate` or default-after-tag-load, `Correct` when a default was seen in time, `-` otherwise), `IAB TCF API`, `IAB GPP API` (`Active`/`-`).
- Finding copy (ids from §7, links from `URLS`): `gcm.ics_no_default` → "Consent Mode Default Status is not set."; `gcm.default_after_tag_load` (wasSetLate) → "Google tags were loaded before Consent Mode Default Status was set, causing consent to be set late. Place the consent default before any Google tag."; (dataLayer order) → "The consent default was pushed after Google Tag Manager loaded (gtm.js). It must be placed before any Google tags."; `gcm.no_consent_mode` → "Google tags are loaded but Google Consent Mode is not active — no consent default/update calls were observed."; `gcm.ads_without_gcm` → "Google Ads tags detected but Google Consent Mode is not active. This may affect ad measurement and remarketing." (rule: `adsActive && !(ics && ics.active)`).
- Signal Breakdown colours: green for `n,t,v`; red for `m,p,q`; amber for `r,u`; grey for `l`/unknown (label `—`). Table `Signal | Status`, plus a `GCD Code` row and a `GCS Code` row.
- Consent Mode Signals table: fixed 7-signal order (`GCM_SIGNALS`), `—` placeholder, green/red colouring; extra column `Google state` from ics (default → update).
- Raw JSON boxes with Copy: `IAB TCF Consent JSON` (latest tcData), `GPP Consent Data JSON` (latest ping), dark monospace, max-height 400 px.
- UET view: `Microsoft UET tag detected` / `Microsoft UET tag not detected on this page`; when the tag is seen without a signal: `No consent signal reported yet. This site may not have Microsoft Consent Mode configured.`; table `Signal | Value` with `ad_storage`; also show the latest `asc` value.
- About view: `About Cookielet Consent Inspector` + blurb + numbered feature cards (Google Consent Mode v2 Checker; IAB TCF v2.2/2.3 validator; IAB GPP; Microsoft UET) + version from `chrome.runtime.getManifest().version` + links (Cookielet, IAB TCF, Google guide).
- Loading text `Searching for consent signals…` until the first `GET_TAB_DATA` resolves; guard text for uninspectable URLs (§8) rendered as a card, not a spinner; `isUninspectableUrl()` from `constants.js` is the single source of truth.
- Not-found state on the TCF view: `No CMP API found on this webpage.` + second line `Neither window.__tcfapi nor a __tcfapiLocator frame was detected.`
- CSV report (IAB layout, proper RFC 4180 quoting — an intentional fix of the validator's unescaped quotes): header `Id,Compliance Check Name,Result`; blocks `SUMMARY` (one row per summary field `Label: value`, then the count lines), `TECHNICAL COMPLIANCE CHECKS` (block result Passed/Failed/Incomplete, then rows `number,text,Passed|Failed|Incomplete|Automatic check was not executed|Manual check was not executed`), `POLICY COMPLIANCE CHECKS`, `CMP AND TCF API CHECK` (sub-group title rows, then `label,value` rows; skip `tcfVersion` and `getTCData` like the validator), `TC String check` (`TC String (via CMP API)`, string, `N bytes`, `TC String manual check`, result, `N bytes`); filename `cookielet-consent-report-<host>-<yyyymmdd>.csv`. JSON export: `{generatedAt, extensionVersion, page, tab, models, findings, manual}`.
- Manual-check controls: two buttons `Pass` / `Fail` (3-state: clicking the active one resets to unanswered), an unanswered marker, ℹ toggles an inline panel with `Manual steps required for this check` (when present) and `Policy Reference (TCF v2)`.

### 13.7 Badge
`badgeStatus`: `error` if any `err` finding; `warning` if any `warn` finding; `pass` if no err/warn and (Google tags seen with a consent default, or a TCF CMP loaded); otherwise `none`. Computed in the worker with the shared models, per tabId.
