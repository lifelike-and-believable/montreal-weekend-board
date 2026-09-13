import { isAuthed, isRefreshJob } from "../lib/auth.js";
import { getDoc, setDoc } from "../lib/store.js";

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
    await setDoc("board/current", {
      WEEKEND, STANDING, EVENTS, AFIELD,
      updatedAt: new Date().toISOString()
    });
    return res.status(200).json({
      ok: true,
      weekendId: WEEKEND.id,
      counts: { standing: STANDING.length, events: EVENTS.length, afield: AFIELD.length }
    });
  } catch (e) {
    console.error("[refresh]", e);
    return res.status(500).json({ code: "store_error", error: String(e.message || e) });
  }
}
