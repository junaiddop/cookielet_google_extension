/**
 * Google Consent Mode v2 validation rules (pure, ESM).
 * Returns findings {id, sev:'err'|'warn'|'info', area, tab:'gcm', title, msg, link?, linkText?}.
 *
 * Precedence for "consent set late" (strongest first):
 *   1. google_tag_data.ics.wasSetLate === true          → Google's own verdict (err)
 *   2. dataLayer order: default index after gtm.js / first config|js index (err)
 *   3. network timing (tag library requested before the default, > 100 ms) → weakest, warn only
 */
import { GCM_V2_REQUIRED, URLS } from '../constants.js';
import { parseGcd, parseGcs } from './gcd_parser.js';
import { effectiveState } from './gcm_model.js';

const NET_MARGIN_MS = 100;

function fmt(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

export function runGcmChecks(tab, gcm) {
  const out = [];
  const add = (id, sev, area, title, msg, link, linkText) => out.push({ id, sev, area, tab: 'gcm', title, msg, link, linkText });
  if (!gcm) return out;
  const ics = gcm.icsFlags || {};
  const hasIcs = !!gcm.ics;
  const tcfBridge = !!(gcm.tcfBridge && gcm.tcfBridge.active);
  const dlDefault = gcm.defaultCount > 0, dlUpdate = gcm.updateCount > 0;
  const icsDefault = ics.usedDefault === true, icsUpdate = ics.usedUpdate === true;

  if (!gcm.googleTagsSeen) return out; // nothing to validate

  /* ---- presence ---- */
  if (!dlDefault && !dlUpdate && !icsDefault && !icsUpdate && !tcfBridge) {
    add('gcm.no_consent_mode', 'err', 'Consent Mode', 'Consent Mode not active',
      'Google tags are loaded but Google Consent Mode is not active — no consent default/update calls were observed.', URLS.GCM_GUIDE, 'Learn about Google Consent Mode');
  }
  if (hasIcs && ics.hasUsedDefaultFlag && !icsDefault && gcm.googleTagsSeen && (icsUpdate || gcm.network.firstCollectAt || gcm.network.firstTagLoadAt)) {
    add('gcm.ics_no_default', 'err', 'Consent Mode', 'Consent Mode Default Status is not set',
      'Consent Mode Default Status is not set. Google tags evaluated consent without a default (google_tag_data.ics.usedDefault is false).', URLS.GCM_GUIDE, 'How to set up Consent Mode Default Status');
  }
  if (dlUpdate && !dlDefault && !icsDefault && !tcfBridge) {
    add('gcm.update_without_default', 'err', 'Consent Mode', 'Update without default',
      'consent update was called without a prior consent default. Google requires a default on every page, set before any measurement commands.', URLS.GCM_GUIDE, 'Learn about Google Consent Mode');
  }
  if (icsDefault && !dlDefault) {
    add('gcm.default_via_gtm_template', 'info', 'Consent Mode', 'Default set inside GTM',
      'The consent default was set inside Google Tag Manager (consent template API). Nothing is pushed to dataLayer, so only google_tag_data.ics reflects it.');
  }
  if (tcfBridge) {
    add('gcm.tcf_bridge_active', 'info', 'Consent Mode', 'gtag TCF bridge active',
      'gtag derives Consent Mode signals from the IAB TC string (gtag_enable_tcf_support / enableAdvertiserConsentMode): ad_storage = purpose 1, ad_personalization = purposes 3+4, ad_user_data = purposes 1+7. These updates never appear in dataLayer.');
  }

  /* ---- ordering ---- */
  let lateReported = false;
  if (ics.wasSetLate === true) {
    lateReported = true;
    add('gcm.default_after_tag_load', 'err', 'Tag order', 'Consent set late',
      'Google tags were loaded before Consent Mode Default Status was set, causing consent to be set late (google_tag_data.ics.wasSetLate). Place the consent default before any Google tag.', URLS.GCM_GUIDE, 'How to fix consent set late');
  }
  const dl = gcm.dl || {};
  if (!lateReported && dl.consentDefaultIndex != null) {
    if (dl.gtmJsIndex != null && dl.consentDefaultIndex > dl.gtmJsIndex) {
      lateReported = true;
      add('gcm.default_after_tag_load', 'err', 'Tag order', 'Default pushed after gtm.js',
        'The consent default was pushed after Google Tag Manager loaded (gtm.js event at dataLayer index ' + dl.gtmJsIndex + ', default at ' + dl.consentDefaultIndex + '). It must be placed before any Google tags.', URLS.GCM_GUIDE, 'Correct tag installation order');
    } else {
      const firstTag = [dl.firstConfigIndex, dl.firstJsIndex].filter((x) => x != null);
      if (firstTag.length && dl.consentDefaultIndex > Math.min(...firstTag)) {
        lateReported = true;
        add('gcm.default_after_tag_load', 'err', 'Tag order', 'Default after gtag config',
          'The consent default was pushed after the first gtag js/config command (dataLayer index ' + Math.min(...firstTag) + ' vs default at ' + dl.consentDefaultIndex + '). Per Google: "If your consent code is called out of order, consent defaults won\'t work."', URLS.GCM_GUIDE, 'Correct tag installation order');
      }
    }
  }
  if (!lateReported && gcm.firstDefaultAt && !gcm.firstDefaultReplayed && gcm.network.firstTagLoadAt &&
      gcm.firstDefaultAt - gcm.network.firstTagLoadAt > NET_MARGIN_MS) {
    add('gcm.default_after_tag_load_net', 'warn', 'Tag order', 'Tag library requested before default',
      'The Google tag library was requested at ' + fmt(gcm.network.firstTagLoadAt) + ', before the consent default fired at ' + fmt(gcm.firstDefaultAt) +
      '. This is a network heuristic (an async script tag placed above the consent snippet triggers it); google_tag_data.ics.wasSetLate is ' + (hasIcs ? String(ics.wasSetLate) : 'unknown') + '.');
  }
  if (gcm.firstDefaultAt && !gcm.firstDefaultReplayed && gcm.network.firstCollectAt && gcm.network.firstCollectAt < gcm.firstDefaultAt - NET_MARGIN_MS) {
    add('gcm.hit_before_default', 'err', 'Tag order', 'Measurement before default',
      'A measurement request was sent at ' + fmt(gcm.network.firstCollectAt) + ', before consent default was set at ' + fmt(gcm.firstDefaultAt) + '.');
  }

  /* ---- v2 signals / best practice ---- */
  if (dlDefault) {
    const missing = GCM_V2_REQUIRED.filter((s) => gcm.defaults[s] == null);
    if (missing.length) {
      add('gcm.v2_signals_missing', 'warn', 'Consent Mode v2', 'Missing v2 signals',
        'Default is missing required v2 signals: ' + missing.join(', ') + '. ad_user_data and ad_personalization are mandatory for EEA traffic since Nov 2023.', URLS.GCM_GUIDE, 'Consent Mode v2 signals');
    }
    if (gcm.waitForUpdate == null) {
      add('gcm.wait_for_update', 'info', 'Best practice', 'No wait_for_update',
        'No wait_for_update in consent default. Recommended (e.g. 500 ms) so the CMP can restore stored consent before tags fire.');
    }
    if (!gcm.regions.length) {
      add('gcm.region', 'info', 'Best practice', 'No region parameter',
        'Consent default has no region parameter — defaults apply worldwide. Scope them to the regions where you surface a banner if that is intended.');
    }
    const regionOnly = GCM_V2_REQUIRED.filter((s) => gcm.defaultScope[s] && gcm.defaultScope[s] !== 'global');
    if (regionOnly.length) {
      add('gcm.region_only_default', 'info', 'Best practice', 'Region-scoped default only',
        'Defaults for ' + regionOnly.join(', ') + ' are region-scoped (' + Object.keys(gcm.regionDefaults).join(', ') + '). Visitors outside those regions get no default and Google treats the signal as granted' +
        (regionOnly.some((s) => gcm.defaultScope[s] === 'mixed') ? '; regions disagree on the value, so the effective default depends on the visitor' : '') + '.');
    }
  }
  // recommendations for pages whose DEFAULT denies ad_storage (the state tags run in before any update)
  const adStorageDenied = (typeof gcm.defaults.ad_storage === 'string' && gcm.defaults.ad_storage === 'denied') ||
    (hasIcs && gcm.icsSignals.ad_storage && gcm.icsSignals.ad_storage.default === 'denied') ||
    (!dlDefault && !hasIcs && effectiveState(gcm, 'ad_storage') === 'denied');
  if (adStorageDenied && gcm.setFlags.ads_data_redaction == null) {
    add('gcm.ads_data_redaction', 'info', 'Best practice', 'ads_data_redaction not set',
      'ads_data_redaction is not set. With ad_storage denied, setting it to true redacts ad click identifiers in Google Ads requests.');
  }
  if (adStorageDenied && gcm.setFlags.url_passthrough == null) {
    add('gcm.url_passthrough', 'info', 'Best practice', 'url_passthrough not set',
      'url_passthrough is not set. With ad_storage denied it lets gclid/dclid be passed through URLs so conversions can still be measured without cookies.');
  }
  if (hasIcs && ics.waitPeriodTimedOut === true) {
    add('gcm.wait_period_timed_out', 'warn', 'Consent Mode', 'wait_for_update expired',
      'wait_for_update' + (gcm.waitForUpdate != null ? ' (' + gcm.waitForUpdate + ' ms)' : '') + ' expired before any consent update arrived; tags fired with the default state (google_tag_data.ics.waitPeriodTimedOut).');
  }
  if (gcm.adsActive && !(hasIcs && ics.active) && !tcfBridge) {
    add('gcm.ads_without_gcm', 'warn', 'Consent Mode', 'Google Ads without Consent Mode',
      'Google Ads tags detected but Google Consent Mode is not active. This may affect ad measurement and remarketing.', URLS.GCM_GUIDE, 'Set up Consent Mode for Google Ads');
  }
  if (gcm.dataLayerNonArray) {
    add('gcm.datalayer_non_array', 'info', 'Consent Mode', 'Non-array dataLayer',
      'window.dataLayer is not a plain array on this page; consent pushes are observed through its push() only.');
  }

  /* ---- dataLayer vs Google state ---- */
  if (hasIcs && (dlDefault || dlUpdate)) {
    const mism = GCM_V2_REQUIRED.filter((s) => {
      const page = gcm.updates[s] != null ? gcm.updates[s] : (typeof gcm.defaults[s] === 'string' ? gcm.defaults[s] : null);
      const google = gcm.icsSignals[s] && gcm.icsSignals[s].effective;
      return page && google && page !== google;
    });
    if (mism.length && !tcfBridge) {
      add('gcm.dl_vs_ics_mismatch', 'warn', 'Consent Mode', 'dataLayer ≠ Google state',
        'The dataLayer consent state differs from what gtag holds in google_tag_data.ics for: ' + mism.join(', ') + '. Region-scoped defaults or a GTM template may be overriding the page commands.');
    }
  }

  /* ---- network vs state: a hit reporting "granted" for a signal whose default was denied, with no update seen ---- */
  const knownDefault = (s) => (hasIcs && gcm.icsSignals[s] && gcm.icsSignals[s].default) || (typeof gcm.defaults[s] === 'string' ? gcm.defaults[s] : null);
  if (!gcm.firstDefaultReplayed && !icsUpdate && !tcfBridge) {
    (gcm.network.signals || []).some((rec) => {
      if (rec.type !== 'hit') return false;
      const grantedOnWire = new Set();
      const gcs = parseGcs(rec.gcs);
      if (gcs && gcs.valid) { if (gcs.ad_storage === 'granted') grantedOnWire.add('ad_storage'); if (gcs.analytics_storage === 'granted') grantedOnWire.add('analytics_storage'); }
      const gcd = parseGcd(rec.gcd);
      if (gcd) Object.keys(gcd.signals).forEach((s) => { const x = gcd.signals[s]; if (x.known && x.update === 'granted') grantedOnWire.add(s); });
      const updateBefore = gcm.firstUpdateAt && !gcm.firstUpdateReplayed && gcm.firstUpdateAt <= rec.timestamp;
      const suspicious = [...grantedOnWire].filter((s) => knownDefault(s) === 'denied' && !(updateBefore && gcm.updates[s] != null));
      if (!suspicious.length) return false;
      add('gcm.retroactive_grant', 'warn', 'Tag order', 'Granted hit without update',
        'A Google request at ' + fmt(rec.timestamp) + ' reported granted consent for ' + suspicious.join(', ') + ' although the default denies it and no consent update was observed before it.');
      return true;
    });
  }

  if (gcm.latestGcd && hasIcs) {
    const mism = GCM_V2_REQUIRED.filter((s) => {
      const net = gcm.latestGcd.signals[s];
      const google = gcm.icsSignals[s];
      return net && net.known && google && net.effective != null && google.effective != null && net.effective !== google.effective;
    });
    if (mism.length) {
      add('gcm.gcd_mismatch', 'info', 'Network', 'gcd ≠ current state',
        'The latest gcd parameter on the wire differs from the current google_tag_data.ics state for: ' + mism.join(', ') + ' (usually a hit sent before the last update).');
    }
  }
  if (gcm.latestGcs && gcm.latestGcs.valid && !gcm.latestGcs.configured && !hasIcs && !dlDefault) {
    add('gcm.gcs_unconfigured', 'warn', 'Network', 'gcs=G1--',
      'Google tags transmit gcs=G1-- (Consent Mode not configured): all storage is treated as granted.');
  }

  const tcf = tab && tab.tcf;
  const tcString = tcf && tcf.data && tcf.data.data && tcf.data.data.tcString;
  if (tcString && gcm.gdprConsentValues.length) {
    const bad = gcm.gdprConsentValues.filter((v) => v.value !== tcString);
    if (bad.length && bad.length === gcm.gdprConsentValues.length) {
      add('gcm.gdpr_consent_mismatch', 'warn', 'Network', 'gdpr_consent ≠ CMP TC string',
        'Google ad requests carry a gdpr_consent TC string that differs from the CMP\'s current TC string (' + bad.length + ' request(s), e.g. ' + bad[0].host + ').');
    }
  }
  const pingCmpId = tcf && tcf.ping && tcf.ping.data && tcf.ping.data.cmpId;
  if (gcm.latestTcfd && gcm.latestTcfd.valid && pingCmpId && gcm.latestTcfd.cmpId && gcm.latestTcfd.cmpId !== pingCmpId) {
    add('gcm.tcfd_cmp_mismatch', 'info', 'Network', 'tcfd CMP id differs',
      'Google tags report CMP id ' + gcm.latestTcfd.cmpId + ' in the tcfd parameter while the CMP ping reports ' + pingCmpId + '.');
  }
  return out;
}

/** Status strip semantics (UniConsent parity, adapted). */
export function gcmStatus(gcm, findings) {
  const errs = (findings || []).filter((f) => f.tab === 'gcm' && f.sev === 'err').length;
  const warns = (findings || []).filter((f) => f.tab === 'gcm' && f.sev === 'warn').length;
  let status, message;
  if (!gcm || !gcm.googleTagsSeen) { status = 'info'; message = 'No Google tags (gtag.js / GTM / Google Ads) detected on this page.'; }
  else if (errs) { status = 'error'; message = errs + ' issue' + (errs > 1 ? 's' : '') + ' found with your Consent Mode implementation.'; }
  else if (warns) { status = 'warning'; message = warns + ' warning' + (warns > 1 ? 's' : '') + ' found. Review the details below.'; }
  else { status = 'pass'; message = 'Consent Mode and CMP are correctly set. Everything is functioning as expected.'; }
  return { status, message, errors: errs, warnings: warns };
}

export default { runGcmChecks, gcmStatus };
