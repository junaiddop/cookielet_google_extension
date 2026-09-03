# Chrome Web Store submission notes

## Single purpose
Inspect and validate consent-management signals (Google Consent Mode v2, IAB TCF, IAB GPP,
Microsoft UET) on the page the user is viewing, for developers, CMP vendors and auditors.

## Permission justifications (Privacy practices tab)

| Permission | Justification |
|---|---|
| `activeTab` | Lets the inspector run on the current tab when the user has restricted site access to "On click". |
| `scripting` | Injects the inspector into tabs that were already open when the extension was installed, only when the user opens the popup or clicks Re-probe. |
| `storage` | Caches the public IAB Global Vendor List / CMP list / Google ATP list locally and stores the user's manual check answers per site; keeps per-tab inspection state in session storage. |
| `webRequest` | Observes (never blocks or modifies) request URLs to Google, Microsoft and server-side tagging endpoints to read the consent parameters (`gcs`, `gcd`, `asc`) tags transmit, and to detect page navigations. |
| `sidePanel` | Shows the inspector in the side panel so it stays open while the user interacts with the consent banner. |
| Host permission `<all_urls>` | Consent banners and Google/Microsoft tags can be on any site; the content script must observe `dataLayer`, `__tcfapi`, `__gpp` and `uetq` on the page the user chooses to inspect. |

## Remote code
None. All logic is packaged. The extension fetches **data** only: the public IAB vendor
list and CMP list (consensu.org) and Google's Additional Consent provider CSV.

## Data usage
No user data leaves the browser. Page-derived consent data is kept in
`chrome.storage.session` (cleared when the browser or extension restarts) and shown only
to the user; exports are user-initiated downloads. No analytics, no accounts.

## Packaging
`npm run package` → `dist/cookielet-consent-inspector-<version>.zip` (manifest at root;
docs, tests, scripts and reference samples excluded; no `key`/`update_url`; bump
`version` in `manifest.json` for every upload).
