# Feature inventory — reference samples vs Cookielet Consent Inspector (current)

Sources (read in full, minified bundles crude-beautified in this directory):
- UniConsent "Consent Data Validator" v0.0.9 — `__unicont_consent_validator/` (background.js, inject.js, startup.js, tag.js → `unicont_tag_crude.js`)
- IAB Europe "CMP Validator" v2.3.2 — `___iab_validator_sample_code/` (React+MUI+@iabtcf/core bundle → `iab_app_region.js`, `src/utils/structure.json`)
- Ours: `cookielet_google_extension/src/**` v1.0.0

## A. UniConsent Consent Data Validator — everything it does

### Injection / capture (inject.js, MAIN world, document_start; startup.js isolated relay)
1. Posts `startup` → background clears the tab's keys (`_gcs,_consentmode,_tcf,_gpp,_diagnostics`).
2. **Polls `window.google_tag_data.ics` every 500 ms** (Google's own internal consent state):
   - `ics.entries[signal].default|update` for the 7 signals → "true"/"false"/"notSet"
   - `ics.usedDefault`, `ics.usedUpdate`, `ics.waitPeriodTimedOut`, `ics.wasSetLate`
   - only sends when JSON of entries changed.
3. **Diagnostics** every poll tick (sent on change):
   - `tcfApiFound` = `typeof __tcfapi==='function' || !!__tcfapiLocator`
   - `gppApiFound` = `typeof __gpp==='function' || !!__gppLocator`
   - `cmpDetected` = `!!window.__unicapi` (their own CMP)
   - `gtagDataFound` = `!!google_tag_data`; `gcmActive` = `google_tag_data.ics.active`
   - walks `dataLayer`: `config G-*` → gtagLoaded; `config AW-*` → adsActive; `consent default` exists; `event:'gtm.load'` seen before any consent default → `gtagConsentDefaultOrder=false`
   - `google_tag_data.tidr.container` keys starting `AW-` → adsActive
4. After DOM ready (+1 s): `__tcfapi('addEventListener')` (only forwards eventStatus `tcloaded`), `__tcfapi('getTCData')` polled 1 s ×60 until `tcloaded|useractioncomplete`; `__gpp('ping')` polled until `signalStatus==='ready'`, `__gpp('addEventListener')` → `pingData`.
5. **Microsoft UET**: hooks `window.uetq.push`, formats `ad_storage` from `uetq` array items or `uetq.uetConfig.consent.adStorageAllowed`.

### Background
- `webRequest.onBeforeRequest` on `<all_urls>`: any URL with `gcs` → stores `{consentActive, gcsCode, gcdCode, npa}` (also reads `tcfd`, unused).
- `webRequest.onHeadersReceived` for `bat.bing.com/action/*`, `commerce.bing.com/cst/0*`, `mtag.microsoft.com/tags/*` → `uet_tag.tagStatus=true`.
- Storage: `chrome.storage.local`, key `<tabId>_<kind>` with `history[]` (popup reads last element). Hourly cleanup of keys for closed tabs; `tabs.onRemoved` cleanup.
- **Badge**: computed from consent-mode `check` + diagnostics: `none` (no Google tags) / `error` (usedDefault===false, wasSetLate, default after gtm.load) / `warning` (no default & no update; adsActive && !gcmActive) / `pass` → text `""`/`ERR`/`!`/`OK` with colours.
- Refreshes badge on storage change, tab activation, tab complete.

### Popup (Preact, 800×600) — tabs
1. **Consent Mode Checker**: status banner (Passed/Info/Warning/Error + message: "Consent Mode and CMP are correctly set…", "N issue(s) found…", "No Google tags (gtag.js / GTM / Google Ads) detected on this page."); status cards **CMP Installed**, **Google Consent Mode** (Active/Not found), **IAB TCF API**, **IAB GPP API**, **Consent Mode Default**, **Tags Loading Order** (Correct/Wrong); error/warning list with doc links:
   - error "Consent Mode Default Status is not set." (usedDefault===false)
   - error "Google tags were loaded before Consent Mode Default Status was set, causing consent to be set late…" (wasSetLate)
   - error "The Consent Mode Default Status stub code was loaded after Google Tag Manager…" (default exists but after gtm.load)
   - warning "Google tags are loaded but Google Consent Mode is not enabled. Your Google tags are not managed by a CMP." (no default & no update)
   - warning "Google Ads tags detected but Google Consent Mode is not active…" (adsActive && !gcmActive)
   - "Consent Mode Signals" table: Signal / Default State / Updated State (from `ics.entries`); GCS Code row.
2. **Consent Mode GCD**: GCD Code + **Signal Breakdown** table Signal/Status with labels "Granted by default", "Denied by default", "Granted after update", "Denied after update", "Granted by default, denied after update", "Denied by default, granted after update", "Granted by default and after update", "Denied by default and after update", "Signal not set" (from gcd letter per signal).
3. **GPP Consent**: detected/not ("IAB GPP stub code is missing." when their CMP detected but no API); table gppVersion / applicableSections / signalStatus / cmpStatus; link to their decoder; JSON textarea with **Copy** ("Copied to clipboard." toast).
4. **IAB TCF Consent**: detected/not; table tcString / addtlConsent / gdprApplies; "Decode at …" link; JSON textarea + Copy.
5. **UET Consent**: tag detected (network) / consent signal (`ad_storage`); "No consent signal reported yet…"
6. **About**: feature blurbs + link.
- Guard: on `chrome://` or Web Store URLs → "Navigate to a website and reopen this panel…" empty state ("Searching for compliance checker…" while loading).
- Re-reads storage on `chrome.storage.onChanged`.

## B. IAB Europe CMP Validator 2.3.2 — everything it does

### Injection
- Action click → `scripting.executeScript` injects a 603px-wide **iframe** (`index.html` or `notfound.html`) into the page; decides by `document.getElementsByName('__tcfapiLocator')[0]`.
- Inside the iframe, a `__tcfapi` **postMessage proxy** (`__tcfapiCall`/`__tcfapiReturn`, walks `parent` to find `frames.__tcfapiLocator`).
- Background: only iframe remove / minimize (90×150) / restore messages.

### Data fetched
- `https://vendor-list.consensu.org/v3/vendor-list.json` (latest GVL)
- `https://cmp-list.consensu.org/v2/cmp-list.json` (`cmps[id] = {name, isCommercial, …}`)
- `https://vendor-list.consensu.org/v3/archives/vendor-list-v{ping.gvlVersion}.json` (CMP's own GVL version)

### Probes (all `__tcfapi(cmd, 2, cb)`): `ping`, `addEventListener` (accepts tcData only if `tcString` string, `isServiceSpecific` boolean, `tcfPolicyVersion` number), `removeEventListener` (registers a listener then removes by `listenerId`), `getTCData`, `getInAppTCData` (optional), `getVendorList` (optional). Records `tcfApi` found and `tcfApiLocator` found.

### UI sections (structure.json) and automated logic (`SP`, `qa`, `om`)
**Summary**: CMP Found (name from cmp-list, "NOT FOUND", or "CMP Loading…"), CMP Id, CMP Version, TCF API Version, TCF Policy Version, GDPR Applies; then counts: "Number of purposes the user has expressed consent for", "…objected to the use of legitimate interest", special features, vendors consent / LI / disclosed; "Technical Compliance Checks passed: X failed: Y to do: Z"; "Policy Compliance Checks passed…".

**Technical Compliance Checks** (13; #1–3 manual, #4–13 automated):
1. (manual) consent signals only after affirmative action
2. (manual) Reject All → all consent signals off
3. (manual) API returns updated TC string after UI change
4. ping && addEventListener && removeEventListener all responded
5. CMP registered: `cmpList.cmps[cmpId]` exists
6. GVL version format: `0 < vendorListVersion(TC) <= latestGVL.vendorListVersion`
7. Current or penultimate GVL: `vendorListVersion >= latest-1`
8. `maxVendorId(consent) <= highestGvlId && maxVendorId(LI) <= highestGvlId`
9. Purposes 1,3,4,5,6 LI all false (`tcData.purpose.legitimateInterests`)
10. `created === lastUpdated`
11. Timestamps imprecise: `created.getSeconds()===0 && lastUpdated.getSeconds()===0` (spec intent: rounded to day)
12. Deleted vendors (ids missing from GVL or with `deletedDate`, using CMP's GVL version if it differs) have no consent/LI signal
13. TC string has disclosedVendors segment: a segment (index 1 or 2) whose first base64url char is in `I..P` (segment type bits 001)

**Policy Compliance Checks**: 32 manual checks (full text + `manualSteps` + `policyReference` HTML in structure.json) with Accept/Deny toggle buttons (3-state), warning icon while unanswered, ℹ popover with manual steps + policy reference.

**CMP and TCF API check**: CMP Information (cmp id, is commercial), CMP API (TCF version, `__tcfapi` found, `__tcfapiLocator` found, ping/getTCData/addEventListener/removeEventListener/getInAppTCData/getVendorList responses), CMP API Ping (cmpLoaded, gdprApplies, cmpStatus, displayStatus).

**TC String Check**: via CMP API (string + byte size, "Gdpr applies: false" when none) and **manual paste** (textarea; compares equality with API string; byte size).

**Purposes (Consent)**, **Purposes (Legitimate Interest)** (1,3,4,5,6 shown greyed "not applicable" to LI), **Special Features**, **Vendors (Consent)**, **Vendors (Legitimate Interest)**, **Vendors (Disclosed)** — each row "id name ✓/✗" **with names from the GVL**; "not applicable" when no TC string.

**Footer**: Download report (CSV: `Id,Compliance Check Name,Result`, sections SUMMARY / technical / policy / CMP+API / TC string; `complianceResult.csv`), **File a complaint** → https://iabeurope.eu/tcf-non-compliance-submission-form/. Not-found page: "No CMP API found on this webpage. CMP validator cannot operate."

## C. Ours today (v1.0.0) — what exists
- MAIN-world injector: dataLayer.push accessor hook (replays existing entries; captures consent default/update + `set ads_data_redaction/url_passthrough`), `__tcfapi` ping + addEventListener, `__gpp` ping/addEventListener/getGPPData, 30 s polling, HELLO/READY handshake queue.
- SW: serialized state, `storage.session`, webRequest on Google hosts (gcs/gcd/npa; tag_load vs collect; firstTagLoadAt/firstCollectAt), badge TCF/CM/ERR, on-demand injection.
- Popup: Overview cards + findings; **Google Consent Mode tab = Consent Mode Signals table (default vs updated from dataLayer) + "Consent Events (dataLayer)" log ("No consent default/update calls captured.") + "Network Signals (gcs / gcd)" table** ← the user's specialty, must stay; IAB TCF tab (summary, TC String Check with copy, purposes/features/vendors id lists, publisher restrictions, ATP, errors); GPP tab (ping summary + raw).
- lib: bitwise TC decoder (core + segments 1 & 3, verified vs @iabtcf/core), gcd/gcs parser (letter map l/m/n/p/q/r/t/u/v).
- Rules: default-before-tag-load, update-without-default, v2 signals, wait_for_update/region/ads_data_redaction, retroactive grant, ping cmpLoaded, TC string version/cmpId/13-month age/policyVersion, AC format.

## D. Gaps (sample has it, we don't) → all to be implemented
UniConsent: google_tag_data.ics reading (usedDefault/usedUpdate/wasSetLate/waitPeriodTimedOut + per-signal default/update as Google sees them); diagnostics (gcmActive, tag IDs, adsActive, gtm.load ordering, `__tcfapiLocator`/`__gppLocator`); UET (uetq hook + bing tag network); badge OK/!/ERR semantics; chrome:// guard; Copy JSON buttons; GCD signal breakdown labels; About tab; per-tab storage cleanup sweep; `gpp` polling until `signalStatus==='ready'`.
IAB: cmp-list lookup (CMP name, isCommercial, registered); GVL fetch (latest + CMP's version) with vendor/purpose names; 10 automated technical checks; 3 manual technical + 32 manual policy checks with persisted answers and info popovers; CMP & TCF API check (all 6 commands incl. removeEventListener/getInAppTCData/getVendorList, locator found, displayStatus); TC string manual paste compare + byte size; summary counts; CSV report; complaint link; not-found state.
Extra (beyond both, cheap and valuable): capture `dma`, `dma_cps`, `gdpr`, `gdpr_consent`, `tcfd` params and verify `gdpr_consent` TC string matches the CMP's; CMP fingerprinting (Cookielet, Cookiebot, OneTrust, …); GPP header decode (version, section ids); JSON export; TC data history (eventStatus timeline).
