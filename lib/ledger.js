/* What the owner has learned about a place they have been to.

   The listing sources for a place (lib/sources.js) are one part of its
   ledger. The rest lives in the same document, sources/<slug>, so a return
   trip starts from everything the first one found rather than from a broad
   search of the region:

     visits    [{ weekendId, from, to, at }]  one per trip, oldest first
     guide     { areas, transit, stays, tips }   short travel notes
     personal  [{ title, cat, venue, sub, weekend, via, at }]   what the
               owner added to a plan or starred while they were there

   The guide is the routine's: where to base yourself, how to get around,
   what to know. Personal notes are the owner's: they are folded in from the
   taste profile (the board records every add and star there), never typed
   twice. Pure helpers here; the I/O is in lib/sources.js and api/trip.js. */

const squash = (s, max) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoOr = (v, d) => (typeof v === "string" && !isNaN(Date.parse(v)) ? v : d);

export const MAX_VISITS = 50;
export const MAX_PERSONAL = 60;
export const GUIDE_CAPS = { areas: 12, transit: 8, stays: 8, tips: 12 };
export const GUIDE_SECTIONS = Object.keys(GUIDE_CAPS);

/* ---- visits --------------------------------------------------------- */

/**
 * Record a trip, once per weekend: the same weekend again only widens the
 * dates it covers and does not count as another visit. Oldest first,
 * bounded.
 */
export function addVisit(visits, { weekendId, from, to, now = new Date().toISOString() } = {}) {
  const list = (Array.isArray(visits) ? visits : []).filter((v) => v && ISO_DATE.test(v.weekendId));
  if (!ISO_DATE.test(weekendId)) return list;
  const f = ISO_DATE.test(from) ? from : weekendId, t = ISO_DATE.test(to) ? to : weekendId;
  const old = list.find((v) => v.weekendId === weekendId);
  if (old) {
    if (f < old.from) old.from = f;
    if (t > old.to) old.to = t;
  } else {
    list.push({ weekendId, from: f, to: t, at: now });
  }
  list.sort((a, b) => (a.weekendId < b.weekendId ? -1 : 1));
  return list.slice(-MAX_VISITS);
}

/** What the plan tells the routine about the owner's history with a place. */
export function summarize(doc, weekendId) {
  const visits = (doc && Array.isArray(doc.visits)) ? doc.visits : [];
  const earlier = visits.filter((v) => v.weekendId !== weekendId);
  return {
    firstVisit: earlier.length === 0,
    visits: earlier.length,
    firstVisitedAt: earlier.length ? earlier[0].from : null,
    lastVisitedAt: earlier.length ? earlier[earlier.length - 1].to : null,
    guide: cleanGuide(doc && doc.guide),
    personal: ((doc && Array.isArray(doc.personal)) ? doc.personal : [])
      .filter((p) => p.weekend !== weekendId).slice(0, 20)
  };
}

/* ---- guide ---------------------------------------------------------- */

/* An item is { name?, note }: areas and stays have a name, transit and tips
   usually do not. Matched by name when it has one, else by its note. */
function cleanItem(raw, now) {
  if (typeof raw === "string") raw = { note: raw };
  if (!raw || typeof raw !== "object") return null;
  const name = squash(raw.name, 60), note = squash(raw.note, 240);
  if (!name && !note) return null;
  const out = {};
  if (name) out.name = name;
  if (note) out.note = note;
  out.at = isoOr(raw.at, now);
  return out;
}
const keyOf = (it) => (it.name || it.note).toLowerCase();

export function cleanGuide(g, now = new Date().toISOString()) {
  const out = {};
  for (const sec of GUIDE_SECTIONS) {
    const seen = new Set(), items = [];
    for (const raw of (g && Array.isArray(g[sec]) ? g[sec] : [])) {
      const it = cleanItem(raw, now);
      if (it && !seen.has(keyOf(it))) { seen.add(keyOf(it)); items.push(it); }
    }
    out[sec] = items.slice(-GUIDE_CAPS[sec]);
  }
  return out;
}

/**
 * Fold a run's notes into the guide. An item with the same name (or note) as
 * one already there replaces it, which is how a note gets corrected; over a
 * section's cap the oldest go. `remove` lists names/notes to take out.
 */
export function mergeGuide(existing, incoming, { remove = {}, now = new Date().toISOString() } = {}) {
  const base = cleanGuide(existing, now), add = incoming && typeof incoming === "object" ? incoming : {};
  const out = {};
  for (const sec of GUIDE_SECTIONS) {
    const gone = new Set((Array.isArray(remove[sec]) ? remove[sec] : []).map((s) => squash(s, 240).toLowerCase()));
    const map = new Map(base[sec].map((it) => [keyOf(it), it]));
    for (const raw of Array.isArray(add[sec]) ? add[sec] : []) {
      const it = cleanItem(raw, now);
      if (!it) continue;
      it.at = now;
      map.delete(keyOf(it));
      map.set(keyOf(it), it);
    }
    for (const k of gone) map.delete(k);
    out[sec] = [...map.values()].slice(-GUIDE_CAPS[sec]);
  }
  return out;
}

export const guideSize = (g) => GUIDE_SECTIONS.reduce((n, s) => n + ((g && g[s]) || []).length, 0);

/* ---- personal notes ------------------------------------------------- */

/**
 * The owner's adds and stars for one weekend, from the taste profile's
 * `recent` list. Hiding is never in it (the board does not record hides).
 * An entry that was added and starred is one note.
 */
export function personalFor(taste, weekendId) {
  const recent = taste && Array.isArray(taste.recent) ? taste.recent : [];
  const out = [];
  for (const r of recent) {
    if (!r || r.weekend !== weekendId || !squash(r.title, 120)) continue;
    out.push({
      title: squash(r.title, 120),
      cat: squash(r.cat, 20),
      venue: squash(r.venue, 80),
      sub: squash(r.sub, 120),
      weekend: weekendId,
      via: r.starred ? "star" : (r.via === "star" ? "star" : "add"),
      at: isoOr(r.at, new Date().toISOString())
    });
  }
  return out;
}

/** Merge notes for a weekend into the stored list: one per title per
    weekend, newest first, bounded. A star on an added entry upgrades it. */
export function mergePersonal(existing, fresh) {
  const keep = (Array.isArray(existing) ? existing : []).filter((p) => p && p.title && p.weekend);
  const map = new Map(keep.map((p) => [p.weekend + "\n" + p.title.toLowerCase(), p]));
  for (const p of fresh) {
    const k = p.weekend + "\n" + p.title.toLowerCase();
    const old = map.get(k);
    map.set(k, old ? { ...old, ...p, via: old.via === "star" || p.via === "star" ? "star" : "add", at: old.at } : p);
  }
  return [...map.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_PERSONAL);
}
