import { isAuthed, isRefreshJob } from "../lib/auth.js";
import { getDoc, setDoc } from "../lib/store.js";
import { pruneBoard } from "../lib/prune.js";
import { locateAll, coverage } from "../lib/location.js";

/* The daily refresh POSTs the four data blocks here instead of
   republishing the artifact's HTML. That is what retires the
   merge-with-the-daily-refresh procedure: code and listings stop
   sharing a file.

   GET (owner or job) reports what is stored, for checking a run landed
   without opening the board. */
export default async function handler(req, res) {
  if (req.method === "GET") {
    if (!isAuthed(req) && !isRefreshJob(req)) {
      return res.status(401).json({ code: "permission_denied", error: "not signed in" });
    }
    try {
      const doc = await getDoc("board/current");
      return res.status(200).json({
        stored: !!doc,
        updatedAt: (doc && doc.updatedAt) || null,
        weekendId: (doc && doc.WEEKEND && doc.WEEKEND.id) || null,
        counts: doc
          ? { standing: (doc.STANDING || []).length,
              events: (doc.EVENTS || []).length,
              afield: (doc.AFIELD || []).length }
          : null
      });
    } catch (e) {
      return res.status(500).json({ code: "store_error", error: String(e.message || e) });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
  if (!isRefreshJob(req)) {
    return res.status(401).json({ code: "permission_denied", error: "refresh token required" });
  }

  const b = req.body || {};
  const { WEEKEND, STANDING, EVENTS, AFIELD } = b;

  if (!WEEKEND || typeof WEEKEND !== "object" || !WEEKEND.id || !Array.isArray(WEEKEND.days)) {
    return res.status(400).json({ code: "bad_weekend", error: "WEEKEND needs id and days[]" });
  }
  for (const [name, v] of [["STANDING", STANDING], ["EVENTS", EVENTS], ["AFIELD", AFIELD]]) {
    if (!Array.isArray(v)) return res.status(400).json({ code: "bad_block", error: `${name} must be an array` });
  }
  /* A run that produced nothing is a failed run, not an empty weekend.
     Refuse it rather than blanking the board. */
  if (!EVENTS.length && !STANDING.length) {
    return res.status(400).json({
      code: "empty_payload",
      error: "EVENTS and STANDING are both empty — refusing to blank the board"
    });
  }

  try {
    /* Read each record's free-text `hood` into a structured `loc` before
       storing, so "Mile End" is one value rather than three. Strictly
       additive: `hood` keeps the text it arrived with and the board goes
       on rendering it verbatim. If this ever throws, the blocks are
       stored exactly as they came — structure is a nicety, the listings
       are the job. */
    let standing = STANDING, events = EVENTS, afield = AFIELD, located = null;
    try {
      standing = locateAll(STANDING);
      events = locateAll(EVENTS);
      afield = locateAll(AFIELD);
      located = coverage([standing, events, afield]);
    } catch (e) {
      console.error("[refresh] locate", e);
      standing = STANDING; events = EVENTS; afield = AFIELD;
    }

    await setDoc("board/current", {
      WEEKEND, STANDING: standing, EVENTS: events, AFIELD: afield,
      updatedAt: new Date().toISOString()
    });

    /* The weekend has turned over, which is the one moment the app knows
       it is safe to let go of the last one. Listings are already stored,
       so nothing below may fail the run: pruneBoard reports its problems
       rather than throwing, and is wrapped again in case that promise
       breaks. Pass prune:false to skip it, pruneDryRun:true to see what a
       run would remove without removing it. */
    let pruned = null;
    if (b.prune !== false) {
      try {
        pruned = await pruneBoard({
          weekendStart: WEEKEND.days[0] && WEEKEND.days[0].date,
          dryRun: !!b.pruneDryRun
        });
        if (pruned.errors.length) console.warn("[refresh] prune", pruned.errors);
      } catch (e) {
        console.error("[refresh] prune threw", e);
        pruned = { errors: [String(e.message || e)] };
      }
    }

    return res.status(200).json({
      ok: true,
      weekendId: WEEKEND.id,
      counts: { standing: STANDING.length, events: EVENTS.length, afield: AFIELD.length },
      located,
      pruned
    });
  } catch (e) {
    console.error("[refresh]", e);
    return res.status(500).json({ code: "store_error", error: String(e.message || e) });
  }
}
