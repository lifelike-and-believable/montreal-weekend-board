import { isAuthed, isRefreshJob } from "../lib/auth.js";
import { listDocs } from "../lib/store.js";
import { toLocal } from "../lib/busy.js";
import { planWeek, cleanPlace } from "../lib/plan.js";
import {
  getSources, saveSources, rankSources, resolvePlace, resolveSlug, addAlias, recordVisit, saveGuide
} from "../lib/sources.js";
import { summarize, cleanGuide, GUIDE_SECTIONS } from "../lib/ledger.js";

/* Days off and travel, for the routine that writes the listings.

   The routine reads Google Calendar, which this app cannot, so it sends
   the week's raw events here and gets back which days to plan (the
   weekend, plus any day off) and where the owner will be. For somewhere
   other than Montreal, it also gets that place's list of good sources,
   and reports back which worked and which did not.

     GET ?place=<slug>       owner or job   a place's sources, best first
     GET                     owner or job   the places with a list: slug, name, count
     POST {op:"plan", events, away, today?}
                             owner or job   planWeek(), plus the sources for its place
     POST {op:"sources", place, sources, used, dead}
                             job            merge into the place's list
     POST {op:"alias", alias, place}
                             job            file another name under a place's list
     POST {op:"visit", place, weekendId, from?, to?}
                             job            record the trip, and fold what the owner
                                            added or starred for it into the place's notes
     POST {op:"guide", place, areas?, transit?, stays?, tips?, remove?}
                             job            add travel notes to the place's guide

   A place is filed under one name however it is written: "NYC", "New York"
   and "Brooklyn, NY" are one list (lib/places.js), and an alias the job adds
   joins any other name to a list.

   The rules live in lib/plan.js and lib/sources.js. */

const MAX_EVENTS = 100;
const MAX_AWAY = 50;
const MAX_SOURCES = 50;
const MAX_URLS = 100;
const MAX_NOTES = 30;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const bad = (res, code, error) => res.status(400).json({ code, error });

/** What a reader needs of a place's list: live sources, best first. */
function live(doc, n) {
  return rankSources((doc && doc.sources) || []).filter((s) => s.status !== "dead").slice(0, n);
}

export default async function handler(req, res) {
  const owner = isAuthed(req), job = isRefreshJob(req);
  if (!owner && !job) return res.status(401).json({ code: "permission_denied", error: "not signed in" });

  try {
    if (req.method === "GET") {
      const asked = req.query && req.query.place;
      if (asked) {
        const doc = await getSources(await resolveSlug(String(asked)));
        return res.status(200).json({
          place: (doc && doc.place) || null,
          updatedAt: (doc && doc.updatedAt) || null,
          sources: rankSources((doc && doc.sources) || []),
          visits: (doc && doc.visits) || [],
          guide: cleanGuide(doc && doc.guide),
          personal: (doc && doc.personal) || []
        });
      }
      const docs = await listDocs("sources");
      const places = docs.map(({ id, data }) => ({
        slug: id,
        name: (data.place && data.place.name) || id,
        count: Array.isArray(data.sources) ? data.sources.length : 0,
        updatedAt: data.updatedAt || null
      })).sort((a, b) => (a.slug < b.slug ? -1 : 1));
      return res.status(200).json({ places });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

    const b = req.body || {};

    if (b.op === "plan") {
      if (!Array.isArray(b.events)) return bad(res, "bad_events", "events must be an array");
      if (b.events.length > MAX_EVENTS) return bad(res, "too_many_events", `at most ${MAX_EVENTS} events`);
      const away = b.away == null ? [] : b.away;
      if (!Array.isArray(away) || away.length > MAX_AWAY) return bad(res, "bad_away", `away must be an array of at most ${MAX_AWAY}`);
      if (b.today != null && !(typeof b.today === "string" && DATE_ONLY.test(b.today))) {
        return bad(res, "bad_today", "today must be YYYY-MM-DD");
      }
      const today = b.today || toLocal(new Date().toISOString()).date;
      let plan;
      try { plan = planWeek(b.events, away, { today }); }
      catch (e) { return bad(res, "bad_today", String(e.message || e)); }

      /* the plan stands even if the list cannot be read */
      let sources = [], ledger = null;
      if (plan.place) {
        try {
          const home = await resolvePlace(plan.place);
          if (home) { plan.place = home; plan.weekend.place = home; }
        } catch (e) { console.error("[trip] alias", e); }
        try {
          const doc = await getSources(plan.place.slug);
          sources = live(doc, 20).map(({ url, name, kind, covers, note, uses }) =>
            ({ url, name, kind, covers, note, uses }));
          ledger = summarize(doc, plan.weekendId);
        } catch (e) { console.error("[trip] sources", e); }
      }
      return res.status(200).json({ ...plan, sources, ledger });
    }

    if (b.op === "sources") {
      if (!job) return res.status(401).json({ code: "permission_denied", error: "refresh token required" });
      const place = cleanPlace(b.place);
      if (!place) return bad(res, "bad_place", "place needs a name, and cannot be home");
      const filed = await resolvePlace(place);
      const lists = [["sources", MAX_SOURCES], ["used", MAX_URLS], ["dead", MAX_URLS]];
      for (const [k, max] of lists) {
        const v = b[k] == null ? [] : b[k];
        if (!Array.isArray(v) || v.length > max) return bad(res, "bad_" + k, `${k} must be an array of at most ${max}`);
      }
      const out = await saveSources(filed, { sources: b.sources || [], used: b.used || [], dead: b.dead || [] });
      return res.status(200).json({ ok: true, ...out });
    }

    if (b.op === "visit") {
      if (!job) return res.status(401).json({ code: "permission_denied", error: "refresh token required" });
      const place = cleanPlace(b.place);
      if (!place) return bad(res, "bad_place", "place needs a name, and cannot be home");
      if (!DATE_ONLY.test(String(b.weekendId || ""))) return bad(res, "bad_weekend", "weekendId must be YYYY-MM-DD");
      for (const k of ["from", "to"]) {
        if (b[k] != null && !DATE_ONLY.test(String(b[k]))) return bad(res, "bad_" + k, `${k} must be YYYY-MM-DD`);
      }
      const out = await recordVisit(await resolvePlace(place), { weekendId: b.weekendId, from: b.from, to: b.to });
      return res.status(200).json({ ok: true, ...out });
    }

    if (b.op === "guide") {
      if (!job) return res.status(401).json({ code: "permission_denied", error: "refresh token required" });
      const place = cleanPlace(b.place);
      if (!place) return bad(res, "bad_place", "place needs a name, and cannot be home");
      for (const sec of GUIDE_SECTIONS) {
        const v = b[sec] == null ? [] : b[sec];
        if (!Array.isArray(v) || v.length > MAX_NOTES) return bad(res, "bad_" + sec, `${sec} must be an array of at most ${MAX_NOTES}`);
      }
      const remove = b.remove == null ? {} : b.remove;
      if (typeof remove !== "object" || Array.isArray(remove)) return bad(res, "bad_remove", "remove must be {section:[name or note]}");
      const incoming = Object.fromEntries(GUIDE_SECTIONS.map((sec) => [sec, b[sec] || []]));
      const out = await saveGuide(await resolvePlace(place), incoming, { remove });
      return res.status(200).json({ ok: true, ...out });
    }

    if (b.op === "alias") {
      if (!job) return res.status(401).json({ code: "permission_denied", error: "refresh token required" });
      let out;
      try { out = await addAlias(b.alias, b.place); }
      catch (e) { return bad(res, "bad_alias", String(e.message || e)); }
      return res.status(200).json({ ok: true, ...out });
    }

    return bad(res, "bad_op", "op must be plan, sources, alias, visit or guide");
  } catch (e) {
    console.error("[trip]", e);
    return res.status(500).json({ code: "store_error", error: String(e.message || e) });
  }
}
