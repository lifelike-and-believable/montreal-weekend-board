/* A running list, per place, of where good listings for it come from.

   When the owner is away the routine has no standing list of sources to
   draw on, as it does for Montreal. So each place it has been asked about
   gets one: sources/<slug>, topped up after every run with the sources
   that worked and the ones that did not, and searched first next time.

     sources/<slug> = { place:{name,region,country}, sources:[...], createdAt, updatedAt }
     places/aliases = { map:{ <placeKey>: <slug> }, updatedAt }   other names for a place
     source = { url, name, kind, covers:[category ids], note, addedAt, lastUsedAt, uses, misses }

   The helpers are pure; getSources / saveSources are the only I/O. */

import { getDoc, setDoc } from "./store.js";
import { cleanPlace, isHomeText } from "./plan.js";
import { placeKey } from "./places.js";

export const KINDS = ["venue", "listings", "press", "ticketing", "community", "official", "social", "other"];
export const MAX_PER_PLACE = 40;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const squash = (s, max) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);

/** https only; lowercase host, no hash, no utm_* params, no trailing slash. Else null. */
export function normalizeUrl(u) {
  if (typeof u !== "string" || u.length > 500) return null;
  let url;
  try { url = new URL(u.trim()); } catch (e) { return null; }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
  for (const k of [...url.searchParams.keys()]) if (/^utm_/i.test(k)) url.searchParams.delete(k);
  const path = url.pathname.replace(/\/+$/, "");
  return url.origin + path + url.search;
}

const isoOr = (v, d) => (typeof v === "string" && !isNaN(Date.parse(v)) ? v : d);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

/** One source as it will be stored, or null if it has no usable url. */
export function cleanSource(s, now = new Date().toISOString()) {
  if (!s || typeof s !== "object") return null;
  const url = normalizeUrl(s.url);
  if (!url) return null;
  const covers = [...new Set((Array.isArray(s.covers) ? s.covers : [])
    .map((c) => String(c).toLowerCase().trim()).filter((c) => /^[a-z0-9_-]{1,40}$/.test(c)))].slice(0, 8);
  return {
    url,
    name: squash(s.name, 80) || new URL(url).hostname,
    kind: KINDS.includes(s.kind) ? s.kind : "other",
    covers,
    note: squash(s.note, 200),
    addedAt: isoOr(s.addedAt, now),
    lastUsedAt: isoOr(s.lastUsedAt, null),
    uses: count(s.uses),
    misses: count(s.misses)
  };
}

export const score = (s) => s.uses - 2 * s.misses;
export const isDead = (s) => s.misses >= 3 && s.misses > s.uses;

function byRank(a, b) {
  return (isDead(a) - isDead(b)) || (score(b) - score(a)) || (b.uses - a.uses) ||
    (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0) || (a.url < b.url ? -1 : 1);
}

/** Best first; sources that keep failing sink to the end, flagged status:"dead". */
export function rankSources(list) {
  return (Array.isArray(list) ? list : []).map((s) => (isDead(s) ? { ...s, status: "dead" } : { ...s }))
    .sort(byRank);
}

/** Drop the weakest until at most `max` remain. A source that has been used
    is never dropped while an unused one is left. */
function evict(list, max) {
  const out = [...list];
  while (out.length > max) {
    const pool = out.some((s) => s.uses === 0) ? out.filter((s) => s.uses === 0) : out;
    const worst = pool.reduce((w, s) => (byRank(s, w) > 0 ? s : w));
    out.splice(out.indexOf(worst), 1);
  }
  return out;
}

/**
 * Fold a run's findings into the stored list.
 * `used` / `dead` are urls, matched after normalising. A url that was not
 * in the list is ignored there: report it as a source first.
 */
export function mergeSources(existing, incoming, { used = [], dead = [], now = new Date().toISOString() } = {}) {
  const map = new Map();
  for (const s of Array.isArray(existing) ? existing : []) {
    const c = cleanSource(s, now);
    if (c && !map.has(c.url)) map.set(c.url, c);
  }
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const c = cleanSource(raw, now);
    if (!c) continue;
    const old = map.get(c.url);
    if (!old) { map.set(c.url, { ...c, addedAt: now, lastUsedAt: null, uses: 0, misses: 0 }); continue; }
    const given = raw && typeof raw === "object" ? raw : {};
    map.set(c.url, {
      ...old,
      name: given.name ? c.name : old.name,
      kind: KINDS.includes(given.kind) ? c.kind : old.kind,
      note: given.note ? c.note : old.note,
      covers: [...new Set([...old.covers, ...c.covers])].slice(0, 8)
    });
  }
  for (const u of Array.isArray(used) ? used : []) {
    const s = map.get(normalizeUrl(u));
    if (s) { s.uses++; s.lastUsedAt = now; }
  }
  for (const u of Array.isArray(dead) ? dead : []) {
    const s = map.get(normalizeUrl(u));
    if (s) s.misses++;
  }
  return evict([...map.values()], MAX_PER_PLACE).sort(byRank);
}

const docPath = (slug) => `sources/${slug}`;

/** The stored doc for a place slug, or null. */
export async function getSources(slug) {
  if (typeof slug !== "string" || !SLUG.test(slug) || slug.length > 60) return null;
  return getDoc(docPath(slug));
}

/** Merge a run's patch ({sources, used, dead}) into a place's list and store it. */
export async function saveSources(place, patch = {}) {
  const p = cleanPlace(place);
  if (!p) throw new Error("a place with a name is required");
  const now = patch.now || new Date().toISOString();
  const doc = await getSources(p.slug);
  const before = new Set(((doc && doc.sources) || []).map((s) => s.url));
  const merged = mergeSources(doc && doc.sources, patch.sources, { used: patch.used, dead: patch.dead, now });
  const known = new Set(merged.map((s) => s.url));
  const hits = (list) => new Set((list || []).map(normalizeUrl).filter((u) => u && known.has(u))).size;
  const out = {
    place: { name: p.name, region: p.region, country: p.country },
    sources: merged,
    createdAt: (doc && doc.createdAt) || now,
    updatedAt: now
  };
  await setDoc(docPath(p.slug), out);
  return {
    slug: p.slug,
    count: merged.length,
    added: merged.filter((s) => !before.has(s.url)).length,
    used: hits(patch.used),
    dead: hits(patch.dead)
  };
}

/* ---- aliases -------------------------------------------------------- */

/* Well-known places fold together in lib/places.js. For the rest, the
   routine says "the owner calls this Burlington too" and the name is filed
   here, so the next trip finds the same ledger. */
const ALIAS_DOC = "places/aliases";
export const MAX_ALIASES = 300;

async function aliasMap() {
  const doc = await getDoc(ALIAS_DOC);
  return (doc && doc.map && typeof doc.map === "object" && !Array.isArray(doc.map)) ? doc.map : {};
}

/** The slug a ledger is filed under for this slug, following one alias. */
export async function resolveSlug(slug) {
  if (typeof slug !== "string") return slug;
  const to = (await aliasMap())[slug];
  return typeof to === "string" && SLUG.test(to) ? to : slug;
}

/**
 * A cleaned place, moved to the ledger its name or slug is an alias of.
 * Unchanged when nothing is filed for it. null stays null.
 */
export async function resolvePlace(place) {
  if (!place) return place;
  const map = await aliasMap();
  const to = map[placeKey(place.name)] || map[place.slug];
  if (typeof to !== "string" || !SLUG.test(to) || to === place.slug) return place;
  const doc = await getDoc(docPath(to));
  return cleanPlace({ ...place, ...((doc && doc.place) || {}), slug: to }) || place;
}

/**
 * File `alias` ("Burlington VT", "the Vineyard") under the ledger of `place`.
 * Returns { alias:<key>, slug } or throws on a bad alias.
 */
export async function addAlias(alias, place) {
  const p = cleanPlace(place);
  if (!p) throw new Error("a place with a name is required");
  const key = placeKey(alias);
  if (key.length < 2 || key.length > 60) throw new Error("alias must be 2 to 60 characters");
  if (isHomeText(key)) throw new Error("alias cannot be home");
  const map = await aliasMap();
  if (!(key in map) && Object.keys(map).length >= MAX_ALIASES) throw new Error(`at most ${MAX_ALIASES} aliases`);
  map[key] = p.slug;
  await setDoc(ALIAS_DOC, { map, updatedAt: new Date().toISOString() });
  return { alias: key, slug: p.slug };
}
