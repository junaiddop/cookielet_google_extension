# Feature parity — reference samples vs Cookielet Consent Inspector v2

Legend: ✅ implemented (same or better) · ➕ implemented beyond the sample · ➖ intentionally not replicated.

## UniConsent Consent Data Validator 0.0.9 (`docs/reference-samples/uniconsent-consent-validator`)

| Sample feature | Status | Where |
|---|---|---|
| Poll `google_tag_data.ics` entries (7 signals default/update) + usedDefault/usedUpdate/wasSetLate/waitPeriodTimedOut | ✅ plus `declare`, `implicit`, `quiet`, `active`, `accessedAny`; re-sent on flag-only changes; event-driven snapshots | `page_injector.js` readIcs; `gcm_model.js` |
| Diagnostics: tcfApiFound / gppApiFound (incl. locator frames), cmpDetected, gtagDataFound, gcmActive, gtagLoaded, adsActive (config AW- / tidr.container), consent default before `gtm.load` | ✅ plus tidr destination maps, google_tag_manager keys, 18 CMP fingerprints, TCF bridge, GPC | `collectDiagnostics` |
| TCF: polled `getTCData` until tcloaded/useractioncomplete | ✅ addEventListener subscription + ping polling stub→loaded + all commands | `probeTcf` |
| GPP: ping polled until `signalStatus==='ready'` | ✅ + addEventListener/removeEventListener/hasSection, 1.0 sync return | `probeGpp` |
| UET: wrap `uetq.push`, read `uetConfig.consent.adStorageAllowed` | ✅ accessor survives bat.js replacement, flat-triple replay, full consent/tcf config | `hookUet` |
| webRequest: any URL with `gcs` (+gcd, npa) | ✅ any host with gcs/gcd + Google/Bing host lists, classified by resource type, dma/dma_cps/gdpr/gdpr_consent/tcfd/gcu/gcut | `network.js` |
| UET tag detection on bat.bing.com/action, commerce.bing.com/cst, mtag.microsoft.com/tags | ✅ + bat.bing.net (cookieless host) + `asc`/`evt`/`gasc` | `network.js` |
| Badge OK / ! / ERR | ✅ per tab, from all findings | `service_worker.js` |
| Status banner (Passed/Info/Warning/Error) with exact copy | ✅ | `gcm_checks.gcmStatus`, `views/gcm.js` |
| Cards: CMP Installed, Google Consent Mode, Consent Mode Default, Tags Loading Order, IAB TCF API, IAB GPP API | ✅ | `views/gcm.js`, `views/overview.js` |
| Error/warning copy: default not set, set late, stub after GTM, tags without consent mode, Ads without consent mode | ✅ (+ Google-doc links) | `gcm_checks.js` |
| Consent Mode Signals table (Signal / Default / Updated) | ✅ + Google state column | `views/gcm.js` |
| GCD Code + Signal Breakdown with the nine labels | ✅ positional decode, declare-aware, colours | `gcd_parser.js`, `views/gcm.js` |
| GPP tab: detected / stub missing / not detected, table, JSON + Copy | ✅ + header decode, probes | `views/gpp.js` |
| TCF tab: tcString / addtlConsent / gdprApplies + JSON + Copy | ✅ (inside the full TCF view) | `views/tcf.js` |
| UET tab: tag detected, "No consent signal reported yet…", ad_storage table | ✅ + config + beacons | `views/uet.js` |
| About tab | ✅ | `views/about.js` |
| chrome:// / Web Store guard | ✅ (`isUninspectableUrl`, missing-URL case) | `main.js` |
| Copy to clipboard toast | ✅ inline "Copied" confirmation | `dom.copyButton` |
| Hourly storage sweep | ➖ unnecessary with `storage.session` + onRemoved/onReplaced/onInstalled | — |
| Console logs on every page | ➖ injector is silent (debug flag) | — |

## IAB Europe CMP Validator 2.3.2 (`docs/reference-samples/iab-cmp-validator`)

| Sample feature | Status | Where |
|---|---|---|
| Not-found page when no `__tcfapiLocator` frame | ✅ (either API or locator counts; two-line message) | `views/tcf.js` |
| Fetch vendor-list.json, cmp-list.json, archived vendor-list-v{N}.json | ✅ cached 24 h, trimmed, LRU archives, canonical cmp-list host + fallback, + Google ATP list | `gvl_service.js`, `gvl.js` |
| Probes: ping, addEventListener, removeEventListener (via listenerId), getTCData, getInAppTCData, getVendorList | ✅ + timeouts, stub→loaded re-probing, locator-only postMessage proxy | `probeTcf`, `makeTcfProxy` |
| Summary: CMP Found / Id / Version / TCF API Version / Policy Version / GDPR Applies; count lines; "passed: x, failed: y, to do: z" | ✅ (`NOT FOUND`, `CMP Loading…`, deleted CMPs) | `tcf_model.js`, `views/tcf.js` |
| Technical checks #1–3 manual, #4–13 automated | ✅ #5 also fails deleted CMPs; #6/#7 fall back to ping.gvlVersion; #11 UTC day precision (spec); #12 archived GVL; gdprApplies=false → not applicable | `technical_checks.js` |
| Policy checks #1–32 with Accept/Deny 3-state, warning marker, ℹ manual steps + policy reference | ✅ Pass/Fail 3-state, answers **persisted per site** | `views/tcf.js`, `service_worker.js` |
| CMP and TCF API check (CMP information / CMP API / CMP API Ping) | ✅ all rows rendered (false rows not hidden), ping history | `tcf_model.apiRows`, `views/tcf.js` |
| TC String Check: via API + byte size; manual paste comparison (colour) | ✅ + decode summary, explicit identical/differs line | `views/tcf.js renderManualPaste` |
| Purposes (Consent / LI with 1,3,4,5,6 greyed), Special Features, Vendors (Consent / LI / Disclosed) with GVL names | ✅ (lists limited to signalled ids with "of N in GVL" counter) | `views/tcf.js` |
| CSV report (`Id, Compliance Check Name, Result`, SUMMARY / TECHNICAL / POLICY / CMP+API / TC string) | ✅ proper RFC 4180 quoting, + JSON report | `export.js` |
| File a complaint link | ✅ | `views/tcf.js` |
| Collapse / minimize the overlay iframe | ➖ popup + side panel instead | — |

## Beyond both samples

Document-identity records (prerender/bfcache safe) · snapshot on re-injection · dataLayer index ordering · `google_tag_data.ics` precedence for "set late" · server-side GTM capture · `tcfd`/`dma`/`gcu`/`gcut` decoding · TCF v2.3 DisclosedVendors mandate · CMP `deletedDate` · policy-version comparison against the live GVL · IABTCF_* storage cross-check · Additional Consent with ATP names and duplicate detection · GPP header decode · UET cookieless host + `asc` · SPA URL tracking · store-ready manifest/locales/packaging · unit + e2e test suites.
