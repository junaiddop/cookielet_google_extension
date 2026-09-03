/**
 * IAB Global Vendor List (v3) and CMP list helpers (ESM).
 *
 * `trimGvl` / `trimCmpList` reduce the raw JSON to what the inspector needs so
 * the cached copies stay small (≈220 KB for the GVL instead of ≈900 KB). The
 * fetch helpers use the global `fetch` and never throw on HTTP errors — they
 * return `{error}` so the caller can surface it in the UI.
 */
import { URLS } from '../constants.js';

const VENDOR_ARRAY_FIELDS = ['purposes', 'legIntPurposes', 'flexiblePurposes', 'specialPurposes', 'features', 'specialFeatures'];

function idNameMap(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) out[k] = { id: v && v.id != null ? v.id : Number(k), name: v && v.name ? String(v.name) : 'id ' + k };
  return out;
}

/** @returns trimmed GVL per docs/DESIGN.md §6 */
export function trimGvl(raw) {
  if (!raw || typeof raw !== 'object' || !raw.vendors) throw new Error('Not a GVL document (missing vendors)');
  const vendors = {};
  let maxVendorId = 0;
  for (const [k, v] of Object.entries(raw.vendors)) {
    const id = Number(v && v.id != null ? v.id : k);
    if (!Number.isFinite(id)) continue;
    if (id > maxVendorId) maxVendorId = id;
    const t = { id, name: v && v.name ? String(v.name) : 'Vendor ' + id };
    if (v && v.deletedDate) t.deletedDate = String(v.deletedDate);
    for (const f of VENDOR_ARRAY_FIELDS) t[f] = Array.isArray(v && v[f]) ? v[f].map(Number) : [];
    vendors[id] = t;
  }
  return {
    vendorListVersion: Number(raw.vendorListVersion) || 0,
    tcfPolicyVersion: Number(raw.tcfPolicyVersion) || 0,
    gvlSpecificationVersion: Number(raw.gvlSpecificationVersion) || 0,
    lastUpdated: raw.lastUpdated || null,
    maxVendorId,
    purposes: idNameMap(raw.purposes),
    specialPurposes: idNameMap(raw.specialPurposes),
    features: idNameMap(raw.features),
    specialFeatures: idNameMap(raw.specialFeatures),
    vendors
  };
}

/**
 * @returns {{lastUpdated, cmps:{[id]:{id,name,isCommercial,deletedDate?,environments?}}}}
 * "TC Strings for CMPs with a deletedDate set must be considered invalid after that date/time" (Global CMP List spec).
 */
export function trimCmpList(raw) {
  if (!raw || typeof raw !== 'object' || !raw.cmps) throw new Error('Not a CMP list document (missing cmps)');
  const cmps = {};
  for (const [k, v] of Object.entries(raw.cmps)) {
    const id = Number(v && v.id != null ? v.id : k);
    if (!Number.isFinite(id)) continue;
    const t = { id, name: v && v.name ? String(v.name) : 'CMP ' + id, isCommercial: !!(v && v.isCommercial) };
    if (v && v.deletedDate) t.deletedDate = String(v.deletedDate);
    if (v && Array.isArray(v.environments)) t.environments = v.environments.map(String);
    cmps[id] = t;
  }
  return { lastUpdated: raw.lastUpdated || null, cmps };
}

/** IDs 1..maxVendorId that are absent from the list or carry a deletedDate. */
export function deletedVendorIds(gvl) {
  const out = [];
  if (!gvl || !gvl.vendors) return out;
  const max = gvl.maxVendorId || Math.max(0, ...Object.keys(gvl.vendors).map(Number));
  for (let id = 1; id <= max; id++) {
    const v = gvl.vendors[id];
    if (!v || v.deletedDate) out.push(id);
  }
  return out;
}

/** CMP list entry status: {registered, deleted, entry}. */
export function cmpStatus(cmpList, cmpId, now = Date.now()) {
  const entry = cmpList && cmpList.cmps ? cmpList.cmps[cmpId] : null;
  if (!entry) return { registered: false, deleted: false, entry: null };
  const deletedAt = entry.deletedDate ? Date.parse(entry.deletedDate) : NaN;
  const deleted = Number.isFinite(deletedAt) ? deletedAt <= now : !!entry.deletedDate;
  return { registered: !deleted, deleted, entry };
}

export function vendorName(gvl, id) {
  const v = gvl && gvl.vendors && gvl.vendors[id];
  return v ? v.name : null;
}

export function purposeName(gvl, id) {
  const p = gvl && gvl.purposes && gvl.purposes[id];
  return p ? p.name : null;
}

/** fetch JSON with a timeout; resolves `{data}` or `{error, status?}`. */
export async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-cache', credentials: 'omit' });
    if (!res.ok) return { error: 'HTTP ' + res.status + ' for ' + url, status: res.status };
    return { data: await res.json() };
  } catch (e) {
    return { error: (e && e.name === 'AbortError') ? 'Timeout fetching ' + url : String((e && e.message) || e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchLatestGvl() {
  const r = await fetchJson(URLS.GVL_LATEST);
  if (r.error) return r;
  try { return { data: trimGvl(r.data) }; } catch (e) { return { error: String(e.message || e) }; }
}

export async function fetchGvlVersion(version) {
  const r = await fetchJson(URLS.GVL_ARCHIVE(version));
  if (r.error) return r;
  try { return { data: trimGvl(r.data) }; } catch (e) { return { error: String(e.message || e) }; }
}

export async function fetchCmpList() {
  let r = await fetchJson(URLS.CMP_LIST);
  if (r.error && URLS.CMP_LIST_FALLBACK) r = await fetchJson(URLS.CMP_LIST_FALLBACK);
  if (r.error) return r;
  try { return { data: trimCmpList(r.data) }; } catch (e) { return { error: String(e.message || e) }; }
}

/** RFC 4180 CSV → array of rows (handles quoted fields with commas, doubled quotes and newlines). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Google ATP list CSV → {[id]:{id,name,policyUrl,domains}} */
export function parseAtpCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return {};
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (n) => header.indexOf(n);
  const iId = idx('provider_id'), iName = idx('provider_name'), iUrl = idx('policy_url'), iDom = idx('domains');
  const out = {};
  for (const r of rows.slice(1)) {
    const id = Number(r[iId]);
    if (!Number.isFinite(id) || id <= 0) continue;
    out[id] = { id, name: (r[iName] || '').trim(), policyUrl: (r[iUrl] || '').trim(), domains: (r[iDom] || '').trim() };
  }
  return out;
}

export async function fetchAtpList() {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
  try {
    const res = await fetch(URLS.ATP_LIST, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-cache', credentials: 'omit' });
    if (!res.ok) return { error: 'HTTP ' + res.status + ' for ' + URLS.ATP_LIST, status: res.status };
    const data = parseAtpCsv(await res.text());
    if (!Object.keys(data).length) return { error: 'ATP list CSV had no rows' };
    return { data };
  } catch (e) {
    return { error: (e && e.name === 'AbortError') ? 'Timeout fetching ATP list' : String((e && e.message) || e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default { trimGvl, trimCmpList, deletedVendorIds, cmpStatus, vendorName, purposeName, fetchJson, fetchLatestGvl, fetchGvlVersion, fetchCmpList, parseCsv, parseAtpCsv, fetchAtpList };
