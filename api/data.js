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
   blocks it shipped with.

   Because that fallback is silent, the response also always sets
   window.__BOARD_FRESH__ saying which path was taken. The shell reads it
   to decide whether the listings on screen can be trusted as current —
   without it, a dead refresh and a live one look identical to the
   viewer. It is a report about the response, never data for the board:
   __BOARD_DATA__ keeps exactly the meaning it had before. */
function js(res, body) {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(body + "\n");
}

/** Escape < so nothing in the payload can close the script tag. */
function lit(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

/** status: ok | signed_out | empty | store_error */
function send(res, fresh, dataJs) {
  const marker = "window.__BOARD_FRESH__=" + lit(fresh) + ";";
  return js(res, dataJs ? marker + "\n" + dataJs : marker);
}

export default async function handler(req, res) {
  if (!isAuthed(req) && !isRefreshJob(req)) {
    return send(res, { status: "signed_out" });
  }
  try {
    const doc = await getDoc("board/current");
    if (!doc || !doc.WEEKEND) return send(res, { status: "empty" });

    const payload = {
      WEEKEND: doc.WEEKEND,
      STANDING: doc.STANDING || [],
      EVENTS: doc.EVENTS || [],
      AFIELD: doc.AFIELD || [],
      updatedAt: doc.updatedAt || null
    };

    const days = Array.isArray(doc.WEEKEND.days) ? doc.WEEKEND.days : [];
    const last = days.length ? days[days.length - 1] : null;

    return send(res, {
      status: "ok",
      weekendId: doc.WEEKEND.id || null,
      label: doc.WEEKEND.label || null,
      lastDay: (last && last.date) || null,
      updatedAt: doc.updatedAt || null
    }, "window.__BOARD_DATA__=" + lit(payload) + ";");
  } catch (e) {
    console.error("[data]", e);
    return send(res, { status: "store_error" });
  }
}
