/**
 * Cached IAB GVL / CMP list / Google ATP list (ESM, service worker).
 *
 * chrome.storage.local keys: gvl_latest, cmp_list, atp_list → {fetchedAt, data};
 * gvl_v<N> → {fetchedAt, lastUsedAt, data} (LRU-capped to MAX_ARCHIVES).
 * All fetches are deduplicated while in flight; errors are returned, never thrown.
 */
import { GVL_TTL_MS, STORAGE_KEYS } from '../shared/constants.js';
import { fetchLatestGvl, fetchGvlVersion, fetchCmpList, fetchAtpList } from '../shared/tcf/gvl.js';

const MAX_ARCHIVES = 3;
const inflight = new Map();

async function readCache(key) {
  try { const r = await chrome.storage.local.get(key); return r[key] || null; } catch (e) { return null; }
}
async function writeCache(key, value) {
  try { await chrome.storage.local.set({ [key]: value }); return true; } catch (e) { return false; }
}
function fresh(entry, now) { return !!(entry && entry.data && typeof entry.fetchedAt === 'number' && now - entry.fetchedAt < GVL_TTL_MS); }

function dedupe(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function getCached(key, fetcher, { force = false, now = Date.now() } = {}) {
  const cached = await readCache(key);
  if (!force && fresh(cached, now)) return { data: cached.data, fetchedAt: cached.fetchedAt, cached: true };
  return dedupe(key, async () => {
    const r = await fetcher();
    if (r.error) return { data: cached ? cached.data : null, fetchedAt: cached ? cached.fetchedAt : null, cached: !!cached, error: r.error };
    await writeCache(key, { fetchedAt: now, data: r.data });
    return { data: r.data, fetchedAt: now, cached: false };
  });
}

async function evictArchives(keep) {
  try {
    const all = await chrome.storage.local.get(null);
    const archives = Object.keys(all).filter((k) => /^gvl_v\d+$/.test(k) && k !== keep)
      .map((k) => ({ k, used: (all[k] && (all[k].lastUsedAt || all[k].fetchedAt)) || 0 })).sort((a, b) => b.used - a.used);
    const drop = archives.slice(MAX_ARCHIVES - 1).map((a) => a.k);
    if (drop.length) await chrome.storage.local.remove(drop);
  } catch (e) { /* ignore */ }
}

async function getArchivedGvl(version, now) {
  const key = STORAGE_KEYS.gvlVersion(version);
  const cached = await readCache(key);
  if (cached && cached.data) {
    writeCache(key, { ...cached, lastUsedAt: now });
    return { data: cached.data, fetchedAt: cached.fetchedAt, cached: true };
  }
  return dedupe(key, async () => {
    const r = await fetchGvlVersion(version);
    if (r.error) return { data: null, error: r.error };
    await evictArchives(key);
    await writeCache(key, { fetchedAt: now, lastUsedAt: now, data: r.data });
    return { data: r.data, fetchedAt: now, cached: false };
  });
}

/**
 * @param {{version?:number, force?:boolean}} opts version = the TC string's vendorListVersion (archive fetched only when ≠ latest)
 * @returns {Promise<{gvl, cmpList, atp, versioned, fetchedAt, errors:object}>}
 */
export async function getGvlState({ version = null, force = false } = {}) {
  const now = Date.now();
  const [g, c, a] = await Promise.all([
    getCached(STORAGE_KEYS.GVL_LATEST, fetchLatestGvl, { force, now }),
    getCached(STORAGE_KEYS.CMP_LIST, fetchCmpList, { force, now }),
    getCached('atp_list', fetchAtpList, { force, now })
  ]);
  const errors = {};
  if (g.error) errors.gvl = g.error;
  if (c.error) errors.cmpList = c.error;
  if (a.error) errors.atp = a.error;
  let versioned = null;
  if (typeof version === 'number' && version > 0 && g.data && version !== g.data.vendorListVersion) {
    const v = await getArchivedGvl(version, now);
    if (v.error) errors.versioned = v.error; else versioned = v.data;
  }
  return { gvl: g.data, cmpList: c.data, atp: a.data, versioned, fetchedAt: g.fetchedAt, cmpListFetchedAt: c.fetchedAt, atpFetchedAt: a.fetchedAt, errors };
}

export default { getGvlState };
