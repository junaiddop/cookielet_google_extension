# Cookielet Consent Inspector (Chrome extension)

A Manifest V3 extension that inspects and validates, on any page:

- **Google Consent Mode v2** — `consent default/update` from dataLayer **and** Google's own
  internal state (`google_tag_data.ics`: usedDefault, usedUpdate, wasSetLate,
  waitPeriodTimedOut), tag-loading order, required v2 signals, best practices, and the
  consent state Google tags actually transmit (`gcs`, `gcd`, `tcfd`, `dma`, `npa`, `gcu`) —
  including server-side GTM endpoints on the publisher's own host.
- **IAB TCF v2.2 (API) / v2.3 (TC string)** — full CMP-Validator parity: registered CMP
  (Global CMP List, incl. deleted CMPs), latest + archived GVL, 13 technical compliance
  checks (10 automated) and 32 manual policy checks with stored answers, CMP & API command
  check (ping / addEventListener / removeEventListener / getTCData / getInAppTCData /
  getVendorList, `__tcfapiLocator`), TC string bit-level decode with byte size and manual
  paste comparison, purposes / special features / vendors with GVL names, publisher
  restrictions, IABTCF_* storage cross-check, Google Additional Consent with ATP names,
  CSV / JSON reports, complaint link.
- **IAB GPP** — `__gpp` 1.1 (ping until ready, listeners, hasSection per supported API),
  header decode with section names, 1.0 fallback.
- **Microsoft UET** — `uetq` consent pushes, the UET instance config after bat.js loads,
  bat.bing.com / bat.bing.net beacons with the `asc` parameter.

No build step, no dependencies. Works as a popup and as a **side panel** (Chrome 116+).

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
2. Open any site, click the Cookielet icon. Use **Side panel** to keep it open while you
   interact with the banner. **Reload the page** once with the inspector installed so
   boot-time events (consent default, tag order, stub → CMP transition) are captured.
3. Fixture pages for a quick tour: `npm run serve:fixtures` → http://127.0.0.1:8899

Store package: `npm run package` → `dist/cookielet-consent-inspector-<version>.zip`.

## Tabs

| Tab | Contents |
|---|---|
| **Overview** | Consent Mode banner (Passed / Info / Warning / Error), status cards (Consent Mode, Default, v2 signals, Tags Loading Order, CMP Detected, TCF API, TC String, GPP, Additional Consent, UET), all findings ranked Error → Warning → Info. |
| **Google Consent Mode** | Status strip · findings · **Consent Mode Signals** (dataLayer default / updated / Google's effective state) · `google_tag_data.ics` flags · **Consent Events (dataLayer)** · **Network Signals (gcs / gcd)** · **Signal Breakdown** (per-signal wording for the latest `gcd`) · detected Google tags. |
| **IAB TCF** | Summary (CMP Found / Id / Version / API version / Policy version / GDPR applies / statuses + counts + "Technical/Policy Compliance Checks passed: x, failed: y, to do: z") · Technical Compliance Checks · Policy Compliance Checks (Pass / Fail per row, ℹ manual steps + policy reference) · CMP and TCF API check · TC String Check (API + manual paste) · Purposes (Consent / LI) · Special Features · Vendors (Consent / LI / Disclosed) · Publisher Restrictions · Google Additional Consent (ATP) · IABTCF_* storage · TCData events · errors · raw JSON. |
| **IAB GPP** | Detection pill, ping fields, header decode, hasSection probes, commands, events, raw JSON. |
| **Microsoft UET** | Tag / queue detection, ad_storage with its source, uetConfig flags, consent pushes, beacons. |
| **About** | Feature summary, usage tips, references, version. |

Footer: **Export JSON**, **Export CSV** (IAB-style compliance report), **Re-probe**
(re-runs every probe and re-sends the page state), **Clear**.

## Key validation rules

| Rule | Severity |
|---|---|
| Google tags loaded, no consent default/update anywhere (dataLayer **or** google_tag_data.ics **or** gtag's TCF bridge) | Error |
| Consent set late: `ics.wasSetLate`, or the default's dataLayer index is after `gtm.js` / the first `config` | Error |
| Tag library requested before the default (network timing only) | Warning (heuristic) |
| `update` without any default · measurement hit before the default | Error |
| `ad_user_data` / `ad_personalization` missing from the default | Warning |
| `wait_for_update` expired before any update · dataLayer ≠ Google state · granted hit with denied default and no update | Warning |
| Missing `wait_for_update` / `region` / `ads_data_redaction` / `url_passthrough` | Info |
| TC string: undecodable · version ≠ 2 · not service-specific · **no DisclosedVendors segment** (mandatory since TCF v2.3, 1 March 2026) · CMP not on the Global CMP List or deleted | Error |
| Policy version ≠ latest GVL · older than 13 months (policy reminder) · localStorage ≠ API · undefined restriction type · required command failed | Warning |
| Technical checks #4–#13 (IAB CMP Validator) failing | Error (one finding per failed check) |
| GPP header ≠ applicable sections · UET tag without consent signal | Warning |

Full rule list: `src/shared/gcm/gcm_checks.js`, `src/shared/checks/findings.js`.

## `gcd` decoding

`gcd` is positional: `1` + `(separator, letter)` × [ad_storage, analytics_storage,
ad_user_data, ad_personalization] + flags (+ container defaults). The classic letters:

| | no update | update denied | update granted |
|---|---|---|---|
| **no default** | `l` (not set → behaves granted) | `m` | `n` |
| **default denied** | `p` | `q` | `r` |
| **default granted** | `t` | `u` | `v` |

Separators encode the implicit boot default (`1` unset, `2` denied, `3` granted); letters
outside l–v carry a `declare` value and are decoded bit-wise. `gcs=G1xy` (`1` granted, `0`
denied, `-` not set); `G1--` = Consent Mode not configured.

## Architecture

```
MAIN world (page)             ISOLATED world         service worker (ES module)      popup / side panel
page_injector.js ─postMessage─▶ content_script.js ─sendMessage─▶ state.js (TabStore) ◀─GET_TAB_DATA─ main.js + views
 hooks dataLayer/uetq          relay + handshake         network.js (webRequest)          shared/* models + checks
 probes __tcfapi/__gpp/ics   ◀─PAGE_CMD REPROBE─        gvl_service.js (GVL/cmp-list/ATP)  export.js (CSV/JSON)
```

- Records are keyed by the top frame's **documentId**; a `main_frame` request resets the
  tab; prerendered documents are ignored; re-injection and bfcache restores merge.
- Every HELLO after the first (extension reload, manual injection, Re-probe) makes the
  injector re-send a full **snapshot** — nothing is lost for tabs that were already open.
- The injector is **silent** on publishers' pages. Debug logging: Shift+click Re-probe.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), contracts: [docs/DESIGN.md](docs/DESIGN.md),
feature → file map: [code.md](code.md), agent guide: [CLAUDE.md](CLAUDE.md).

## Development

```bash
npm test          # 49 unit tests (decoders verified against @iabtcf/core vectors)
npm run check     # syntax, manifest/locales, import graph, sidepanel parity, unit
npm run e2e       # 67 end-to-end checks in headless Chromium (needs Chromium / Chrome for Testing;
                  # branded Chrome refuses --load-extension; set CHROME_BIN if not auto-detected)
```

The e2e harness (`test/e2e/cdp.js`) speaks CDP over `--remote-debugging-pipe` with zero
dependencies, reads the worker's `chrome.storage.session`, and renders every popup view
inside the real extension page.

## Reference material

`docs/reference-samples/` holds the two extensions this one was benchmarked against
(UniConsent Consent Data Validator 0.0.9, IAB Europe CMP Validator 2.3.2) — see
[docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md). They are excluded from the store package.

## Limitations

Top frame only (CMPs in cross-origin iframes are reached through the `__tcfapiLocator`
postMessage API); POST bodies are not parsed; custom-named dataLayers are hooked when
discoverable via `google_tag_manager`; manual policy checks are human judgement; ordering
rules are evaluated for the initial document load (SPA navigations are marked in the logs).
