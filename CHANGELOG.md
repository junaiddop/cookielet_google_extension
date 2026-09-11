# Changelog

## 2.0.0 — 2026-09-03

Rebuilt to full parity with the UniConsent Consent Data Validator and the IAB Europe CMP
Validator, plus spec-driven checks beyond both.

### Added
- Google Consent Mode: `google_tag_data.ics` capture (usedDefault/usedUpdate/wasSetLate/waitPeriodTimedOut, per-signal implicit/declare/default/update), dataLayer index ordering, GTM-template and gtag-TCF-bridge awareness, status banner + cards, Signal Breakdown, positional `gcd` decoding (declare/implicit/flags), `gcs` `-` states, `tcfd`/`dma`/`dma_cps`/`gcu`/`gcut`/`npa` capture, server-side GTM endpoints, detected tag ids.
- IAB TCF: Global CMP List (incl. deletedDate), GVL v3 latest + archived, Google ATP list, technical checks #4–#13, 32 manual policy checks with persisted answers and policy references, CMP & API command check (all six commands, locator, ping history), stub→loaded re-probing, locator-only postMessage proxy, IABTCF_* storage snapshot, TCF v2.3 DisclosedVendors mandate, policy version vs live GVL, manual TC string paste, CSV/JSON reports, complaint link.
- IAB GPP: 1.1 probes (listeners, hasSection), header decode, 1.0 sync fallback.
- Microsoft UET: uetq accessor hook, UET instance config, bat.bing.com/.net beacons with `asc`.
- Side panel page, About tab, Re-probe, Clear, debug toggle, `_locales`, store packaging script, unit + e2e test suites.

### Changed
- Records keyed by top-frame `documentId`; navigation resets on the `main_frame` request; prerender ignored; bfcache and re-injection merge via snapshots.
- Content scripts are silent on publishers' pages; lazy `dataLayer`/`uetq` accessors (the page is never given a dataLayer it did not define).
- `gcm.default_after_tag_load` precedence: `ics.wasSetLate` → dataLayer order → network timing (warning only).
- 13-month TC string age is a warning (policy reminder), not a validity error.

### Removed
- `src/utils/` (moved to `src/shared/`), the single-file popup, verbose console logging.

## 1.0.0 — 2026-09-01
Initial release: TCF v2.2 decoder, Consent Mode dataLayer capture, gcs/gcd sniffing, GPP ping, popup + side panel.
