import { isAuthed, isRefreshJob } from "../lib/auth.js";
import { getDoc } from "../lib/store.js";

/* Serves /board-data.js — this weekend's four data blocks, written by
   the daily refresh.

   Loaded by a plain <script> tag placed before the board's own script,
   so window.__BOARD_DATA__ is set by the time the board declares its
   inline blocks and can override them synchronously. No HTML splicing,
   and the page itself stays a static asset.

   Every failure path returns 200 with a comment body rather than an
   error. A refresh that hasn't run, a store that's down, or a signed-out
   viewer must never break the page: the board simply keeps the inline
   blocks it shipped with. */
function js(res, body) {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(body + "\n");
}

export default async function handler(req, res) {
  if (!isAuthed(req) && !isRefreshJob(req)) {
    return js(res, "/* not signed in — board keeps its inline blocks */");
  }
  try {
    const doc = await getDoc("board/current");
    if (!doc || !doc.WEEKEND) return js(res, "/* no refresh stored yet */");

    const payload = {
      WEEKEND: doc.WEEKEND,
      STANDING: doc.STANDING || [],
      EVENTS: doc.EVENTS || [],
      AFIELD: doc.AFIELD || [],
      updatedAt: doc.updatedAt || null
    };
    // escape < so a string inside the data can never close the script tag
    const json = JSON.stringify(payload).replace(/</g, "\\u003c");
    return js(res, "window.__BOARD_DATA__=" + json + ";");
  } catch (e) {
    console.error("[data]", e);
    return js(res, "/* store unavailable */");
  }
}
