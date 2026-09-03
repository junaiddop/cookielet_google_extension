# Architecture

## Processes and worlds

| Context | File(s) | Can use | Talks to |
|---|---|---|---|
| Page MAIN world (document_start) | `src/content/page_injector.js` | page globals only (no `chrome.*`, page CSP applies) | isolated relay via `window.postMessage` |
| Isolated world | `src/content/content_script.js` | `chrome.runtime`, `chrome.storage` | worker via `chrome.runtime.sendMessage`; page via `postMessage` |
| Service worker (module) | `src/background/*.js` | all extension APIs | `chrome.storage.session` (records), `chrome.storage.local` (GVL caches, manual answers, debug flag) |
| Popup / side panel | `src/popup/*` | extension APIs | worker via `sendMessage`; reads the same shared library |

## Data flow

1. **Boot** — the injector installs lazy accessors on `window.dataLayer` and `window.uetq`,
   wraps `history.pushState/replaceState`, posts `READY`, sends `PAGE_INIT` and starts a
   500 ms tick (60 s) then a 2 s tick (5 min). Event-driven snapshots (consent push,
   visibility change, TCF events, `load`, `pageshow`) keep working for the document's life.
2. **Handshake** — the relay answers `READY` with `HELLO {debug}`; the injector flushes its
   queue. A later `HELLO` (relay re-executed after an extension reload or `ENSURE_INJECTED`)
   triggers `snapshot({replayed:true})`.
3. **Records** — the worker's `TabStore.apply(tabId, payload, sender)` runs on one promise
   chain. `PAGE_INIT` decides reset vs merge by `sender.documentId`; other events are
   ignored when their `documentId` does not match the record (stale document).
4. **Network** — `webRequest.onBeforeRequest` on `<all_urls>` (top frame only):
   `main_frame` → `resetForNavigation`; scripts → `tag_load` (lib gtag/gtm/gpt/adsense/uet);
   image/xhr/ping/beacon → `hit` (collect/conversion/audience/ad_request/diagnostics);
   Bing hosts → `bing_hit`/`bing_tag`. Consent parameters are copied, the path is
   truncated to 120 chars, `gdpr_consent` capped.
5. **Badge** — recomputed (debounced) from the shared models on every change; per tab;
   re-applied after navigation.
6. **Popup** — polls `GET_TAB_DATA` (2 s) and listens to `chrome.storage.session.onChanged`;
   re-renders only when `rev` changes; asks for `ENSURE_INJECTED` once per uninstrumented
   tab; fetches `GET_GVL` (latest GVL + cmp-list + ATP list, plus the archived GVL matching
   the TC string version); stores manual answers per host via `SET_MANUAL`.

## Record shape (per tab)

See `src/background/state.js → blankTab()` and `docs/DESIGN.md §5`. Highlights:
`documentId`, `instrumented`, `diagnostics`, `gcm.{events, dl, ics, icsHistory}`,
`tcf.{apiFound, locatorFound, viaPostMessage, ping, pingHistory, data, history, commands, errors, storage}`,
`gpp.{apiFound, ping, events, data, errors, commands, sections}`, `uet.{apiFound, kind, config, events}`,
`network.{signals, firstTagLoadAt, firstCollectAt}`, `rev`, `updatedAt`.

## Models and checks (pure, shared by worker + popup + tests)

`gcm_model → gcm_checks`, `tcf_model (→ technical_checks) → findings.runTcfChecks`,
`findings.runGppChecks`, `uet_model.runUetChecks`, aggregated by `collectFindings` and
turned into a badge by `badgeStatus`. All modules are side-effect free and importable in Node.

## Storage budget

`chrome.storage.session` (10 MB): per-tab caps in `constants.CAPS`; on quota errors the
store halves the bulk arrays and retries. `chrome.storage.local` (10 MB): trimmed GVL
≈ 220 KB, cmp-list ≈ 17 KB, ATP list ≈ 60 KB, at most 3 archived GVL versions (LRU),
manual answers ≈ 1 KB per host.

## Chrome version ledger

`minimum_chrome_version 116`: `sidePanel.open` 116, `storage.session` 10 MB 112,
`content_scripts.world` 111, `setBadgeTextColor` 110, `MessageSender.documentId`/
`documentLifecycle` + webRequest `documentLifecycle` 106, `scripting.injectImmediately` 102.
Not used: JSON import attributes (123+), dynamic `import()` in the worker (unsupported).
