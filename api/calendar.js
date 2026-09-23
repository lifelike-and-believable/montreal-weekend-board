import { isAuthed, isRefreshJob } from "../lib/auth.js";
import { getDoc, setDoc } from "../lib/store.js";
import { busyForWeekend, canRefresh } from "../lib/busy.js";

/* The owner's calendar, on demand.

   The daily refresh reads the calendar once each morning. Something added
   at lunch would otherwise wait until tomorrow, so the board can ask for a
   fresh read: it POSTs {op:"refresh"} here, this starts a small Claude
   routine through its API trigger, and that routine reads Google Calendar
   and POSTs {op:"store", BUSY} back. The board polls GET until busyAt
   moves.

     GET                     owner or job   this weekend's days, BUSY, busyAt,
                                            and whether a refresh can be asked for
     POST {op:"refresh"}     owner          start the calendar routine
     POST {op:"store", ...}  job            replace BUSY for this weekend

   Nothing here touches the listings. The routine's URL and token live in
   CALENDAR_ROUTINE_URL / CALENDAR_ROUTINE_TOKEN; without them the board
   simply does not offer the button. */

const FIRE_DOC = "board/calendar-fire";
/* Each run counts against the account's daily routine allowance, and one
   takes a minute or two, so a second tap inside this window is refused
   rather than starting another. */
export const COOLDOWN_MS = 3 * 60 * 1000;

async function fire() {
  const r = await fetch(process.env.CALENDAR_ROUTINE_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.CALENDAR_ROUTINE_TOKEN}`,
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  return { ok: r.ok, status: r.status, body };
}

export default async function handler(req, res) {
  const owner = isAuthed(req), job = isRefreshJob(req);
  if (!owner && !job) return res.status(401).json({ code: "permission_denied", error: "not signed in" });

  try {
    if (req.method === "GET") {
      const doc = await getDoc("board/current");
      const f = await getDoc(FIRE_DOC);
      return res.status(200).json({
        weekendId: (doc && doc.WEEKEND && doc.WEEKEND.id) || null,
        days: (doc && doc.WEEKEND && doc.WEEKEND.days) || [],
        BUSY: (doc && doc.BUSY) || [],
        busyAt: (doc && doc.busyAt) || null,
        firedAt: (f && f.firedAt) || null,
        canRefresh: canRefresh()
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

    const b = req.body || {};

    if (b.op === "refresh") {
      if (!owner) return res.status(401).json({ code: "permission_denied", error: "owner only" });
      if (!canRefresh()) return res.status(501).json({ code: "not_configured", error: "calendar routine is not set up" });
      const f = await getDoc(FIRE_DOC);
      const last = f && f.firedAt ? Date.parse(f.firedAt) : 0;
      if (last && Date.now() - last < COOLDOWN_MS) {
        return res.status(429).json({ code: "cooldown", firedAt: f.firedAt,
          retryInMs: COOLDOWN_MS - (Date.now() - last) });
      }
      const firedAt = new Date().toISOString();
      /* claim the slot before the call, so two taps can't both fire */
      await setDoc(FIRE_DOC, { firedAt });
      const out = await fire();
      if (!out.ok) {
        await setDoc(FIRE_DOC, { firedAt: null, lastError: out.status });
        return res.status(502).json({ code: "fire_failed", status: out.status });
      }
      return res.status(202).json({ ok: true, firedAt,
        session: (out.body && out.body.claude_code_session_url) || null });
    }

    if (b.op === "store") {
      if (!job) return res.status(401).json({ code: "permission_denied", error: "refresh token required" });
      if (!Array.isArray(b.BUSY)) return res.status(400).json({ code: "bad_busy", error: "BUSY must be an array" });
      const doc = await getDoc("board/current");
      if (!doc || !doc.WEEKEND) return res.status(409).json({ code: "no_board", error: "no weekend stored yet" });
      /* a read made for last weekend must not land on this one */
      if (b.weekendId && b.weekendId !== doc.WEEKEND.id) {
        return res.status(409).json({ code: "stale_weekend", weekendId: doc.WEEKEND.id });
      }
      const BUSY = busyForWeekend(b.BUSY, doc.WEEKEND.days);
      const busyAt = new Date().toISOString();
      await setDoc("board/current", { ...doc, BUSY, busyAt });
      return res.status(200).json({ ok: true, weekendId: doc.WEEKEND.id, busy: BUSY.length, busyAt });
    }

    return res.status(400).json({ code: "bad_op", error: "op must be refresh or store" });
  } catch (e) {
    console.error("[calendar]", e);
    return res.status(500).json({ code: "store_error", error: String(e.message || e) });
  }
}
