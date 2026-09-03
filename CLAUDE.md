# CLAUDE.md — Cookielet Consent Inspector (Chrome extension)

> Guide for AI agents (and humans) working in `cookielet_google_extension/`. Read this
> before editing. The feature → file map lives in [code.md](code.md); the binding design
> contract is [docs/DESIGN.md](docs/DESIGN.md) (§13 addenda override earlier sections).

## What this is

A **Manifest V3 Chrome extension** (no build step, no runtime dependencies) that inspects and
validates consent signals on any page:

| Area | What it checks |
|---|---|
| Google Consent Mode v2 | dataLayer `consent default/update`, Google's own `google_tag_data.ics` state, tag loading order, `gcs`/`gcd`/`tcfd`/`dma`/`npa` on the wire |
| IAB TCF v2.2 API / v2.3 string | CMP-Validator parity: cmp-list + GVL lookups, 13 technical checks (10 automated), 32 manual policy checks, CMP API command check, TC string decode + manual paste, purposes/features/vendors with names, Google Additional Consent |
| IAB GPP | `__gpp` 1.1 ping/events/hasSection, header decode |
| Microsoft UET | `uetq` consent pushes, UET instance config, bat.bing.com/.net beacons (`asc`) |

Cookielet's own CMP ID is **503**; the extension is generic and works on any site.

## Layout (keep it this way)

```
manifest.json · _locales/en/messages.json · icons/
src/
  shared/        pure ESM library — NO chrome.* at import time (Node tests import it)
    constants.js       MSG/EVT/URLS/CAPS — the contract hub
    tcf/               tc_decoder, ac_parser, gvl (trim/fetch/ATP csv), technical_checks, policy_checks, tcf_model
    gcm/               gcd_parser (positional gcd/gcs/tcfd), gcm_model, gcm_checks
    gpp/gpp_header.js  uet/uet_model.js  checks/findings.js  report/export.js  util/{dom,csv}.js
  data/tcf_checks.json IAB validator check catalogue (technical 1–13, policy 1–32, CMP&API rows)
  background/    ESM service worker: service_worker (entry), state (TabStore), network (webRequest), gvl_service (cache)
  content/       CLASSIC scripts (no imports): page_injector.js (MAIN world), content_script.js (isolated relay)
  popup/         popup.html + sidepanel.html (identical except data-ctx), popup.css, main.js, components.js, views/*
test/            unit (node --test), e2e (dependency-free CDP harness), fixtures (pages + fake gtag/CMP/UET + GVL/TC vectors)
scripts/         check.sh (static checks + unit), package.sh (store zip)
docs/            DESIGN.md, ARCHITECTURE.md, FEATURE-PARITY.md, STORE-LISTING.md, reference-samples/ (the two sample extensions)
```

## Commands

```bash
npm test                 # unit tests (Node 18+, node:test)
npm run e2e              # headless Chromium e2e — needs a Chromium/Chrome-for-Testing binary (CHROME_BIN or ~/.cache/ms-playwright)
npm run check            # syntax + manifest + import graph + sidepanel parity + unit
npm run package          # dist/cookielet-consent-inspector-<version>.zip for the Web Store
npm run serve:fixtures   # http://127.0.0.1:8899 — open the fixtures in a real Chrome with the extension loaded
```

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → this folder.
**Never put a `_`-prefixed file/folder at the top level** (Chrome refuses to load it); the
reference samples live under `docs/reference-samples/` for that reason.

## Rules that must not be broken

1. **Content scripts are silent.** `page_injector.js` runs on publishers' pages: no
   `console.*` (except inside `dbg()` gated by the debug flag), no `innerHTML`, no
   `<script>` injection, no `chrome.*`. `test/unit/contract.test.js` enforces this and
   keeps the `EVT`/`POST_SOURCE` literals in the two classic scripts in sync with
   `constants.js` — extend `EVT` in three places (constants, injector, `state.js`).
2. **Service worker is an ES module**: static imports only, **no top-level await**, every
   `chrome.*.addListener` registered synchronously in the first evaluation; hydration is
   lazy inside `TabStore.run()`; every message handler calls `sendResponse` and returns
   `true` only when async; unknown actions return `undefined`.
3. **One serialized chain.** All tab-record mutations go through `TabStore.run()` (arrival
   order). Persistence is debounced and awaited; quota errors trim the record.
4. **Document identity, not readyState.** Records are keyed by the top frame's
   `documentId`; a `main_frame` request resets the tab; prerendered documents are ignored;
   a `PAGE_INIT` from a different `documentId` resets, same `documentId` merges.
5. **Every HELLO after the first (and `REPROBE`) triggers a full snapshot** from the
   injector (PAGE_INIT with `replayed:true`, dataLayer replay with `dlIndex`, ics,
   diagnostics, TCF ping/getTCData, GPP ping, UET state, IABTCF_* storage). Replayed
   consent events are deduped by `(command, dlIndex, params)` in `gcm_model`.
6. **Hooks are lazy accessors.** `window.dataLayer` / `window.uetq` are never
   materialised by us; the getter returns `undefined` until the page assigns. `push` is
   guarded with an accessor so GTM/gtag/bat.js re-wrapping is re-wrapped again, and a
   depth counter prevents double capture when their wrapper calls ours.
7. **`google_tag_data.ics` is authoritative** for Consent Mode (GTM consent templates
   never touch dataLayer). "Consent set late" precedence: `ics.wasSetLate` (err) →
   dataLayer index order (err) → network timing (warn only, top frame, non-replayed).
8. **Network classification by `details.type`**, top frame only, any host with
   `gcs`/`gcd` (server-side GTM); never store full query strings; `gdpr_consent` is capped.
9. **Popup renders only when `rev` changes**; `<details data-key>` open state is
   preserved; the manual TC-string textarea lives outside the re-rendered subtree; all
   text via `textContent`; `href`s only `https?:`.
10. **Spec truth over sample truth.** Where the reference samples are wrong (validator
    check #11 seconds-only, letter-only gcd parsing, `getTCData` treated as required,
    13-month rule as string validity) we follow the spec and say so in the detail text.

## Where things come from

- gcd/gcs/tcfd/dma encodings and `google_tag_data.ics` semantics: derived from the live
  gtag.js source (see `docs/DESIGN.md §13.4/§13.5` and `src/shared/gcm/gcd_parser.js` header).
- TCF checks: IAB CMP Validator 2.3 (`docs/reference-samples/iab-cmp-validator`) + TCF v2.2
  CMP API / v2.3 TC string specs. Check texts: `src/data/tcf_checks.json` (generated from
  the validator's `structure.json`, HTML stripped).
- UniConsent Consent Data Validator: status-strip semantics, Signal Breakdown wording,
  banner copy, UET handling (`docs/reference-samples/uniconsent-consent-validator`).
- TC string test vectors: encoded with `@iabtcf/core` 1.5.6 from the popup builder's
  node_modules (`test/fixtures/data/tc_vectors.json`, oracle-checked field by field).

## Adding a check

1. Put the rule in the right pure module (`gcm_checks.js`, `findings.js` → `runTcfChecks`,
   `runGppChecks`, `uet_model.js` → `runUetChecks`). Finding shape:
   `{id, sev:'err'|'warn'|'info', area, tab, title, msg, link?, linkText?}` with a stable id.
2. Add a unit test in `test/unit/gcm.test.js` (scenario built from `blankTab()`).
3. If it needs new page data: add an `EVT`, emit it in the injector, handle it in
   `state.js`, extend the tab record shape in `docs/DESIGN.md §5`.
4. Views pick findings by `tab`; the Overview shows all of them.

## Debugging

- Toggle debug logging: Shift+click **Re-probe** in the popup footer (sets
  `chrome.storage.local.debug`). Worker logs as `[Cookielet SW]`, injector as
  `[Cookielet Inspector]`, relay as `[Cookielet Relay]`.
- Worker console: `chrome://extensions` → service worker link. Popup: right-click → Inspect.
- `E2E_KEEP=1 npm run e2e` keeps the headless browser alive 30 s at the end.
- The GVL/cmp-list/ATP caches live in `chrome.storage.local` (`gvl_latest`, `cmp_list`,
  `atp_list`, `gvl_v<N>`), 24 h TTL; **Refresh GVL** on the TCF tab forces a refetch.
