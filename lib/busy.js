/* The owner's own calendar, cut to the weekend the board shows.

   The refresh reads Google Calendar and sends what it finds as BUSY, one
   entry per calendar event:

     { id, title, start, end, location?, timeZone?, hood? }

   `start` / `end` are either ISO datetimes with an offset
   ("2026-09-26T10:00:00-04:00") or, for an all-day event, bare dates
   ("2026-09-26") with `end` exclusive, which is how Google reports them.
   `timeZone` is the event's own zone ("America/Vancouver"). `hood` is
   set only for a Montreal location, in the listings' own format ("Mile
   End · métro Laurier"), and is read into `loc` by the same parser the
   listings go through, so an entry on your calendar gets the same métro
   dots and the itinerary can say how far it is from the next pick.

   The board thinks in days and "HH:MM", so each event becomes one segment
   per weekend day it touches:

     { id, day:"sat", from:"10:00", to:"14:00", allDay:false, title, where, zone, hood?, loc? }

   An event at home is cut in Montreal time and `zone` is null. An event
   whose own zone keeps a different clock (a gig in Revelstoke) is cut
   and shown in that zone's time, and `zone` names it ("PDT"): on the
   road, 8:10 p.m. is what the ticket says.

   AWAY is the other half: when the owner is out of town, so nothing in
   Montreal is on the cards. The refresh judges that from flights, hotels
   and trips and sends { start, end, where } spans; any timed event in
   another clock counts as away too, whatever it sends. Away is always
   cut in Montreal time, since what it is checked against is Montreal
   listings:

     { id, day:"sat", from:null, to:null, allDay:true, where:"Revelstoke" }

   Anything outside the weekend is dropped. */

import { parseHood } from "./location.js";

const TZ = "America/Toronto";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EVENTS = 100;

const fmts = new Map();
function clockIn(tz) {
  if (!fmts.has(tz)) {
    fmts.set(tz, new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    }));
  }
  return fmts.get(tz);
}

/** A datetime as a zone's clock reads it: { date:"YYYY-MM-DD", min }. Montreal by default. */
export function toLocal(iso, tz = TZ) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p = {};
  for (const part of clockIn(tz).formatToParts(d)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + (+p.minute) };
}

/** An IANA zone this runtime knows, or null. */
function knownZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return null;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; }
  catch (e) { return null; }
}

/** Short name of a zone at an instant: "PDT", or "GMT-7" where there is none. */
function zoneName(tz, iso) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(new Date(iso)).find((x) => x.type === "timeZoneName");
  return p ? p.value : tz;
}

/** A zone whose clock reads differently from Montreal's at this instant. */
function foreignAt(tz, iso) {
  if (!tz || tz === TZ) return false;
  const a = toLocal(iso, tz), b = toLocal(iso, TZ);
  return !!(a && b && (a.date !== b.date || a.min !== b.min));
}

function hhmm(m) {
  const h = Math.floor(m / 60), r = m % 60;
  return (h < 10 ? "0" : "") + h + ":" + (r < 10 ? "0" : "") + r;
}

function clean(s, max) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Span of one start/end pair on a zone's clock, or null if it cannot be read. */
function span(s, e, tz = TZ) {
  e = e || s;
  if (typeof s !== "string" || typeof e !== "string") return null;
  if (DATE_ONLY.test(s)) {
    /* all day, end exclusive; a missing or equal end means one day */
    const endEx = DATE_ONLY.test(e) && e > s ? e : null;
    return { allDay: true, startDate: s, toExclusiveDate: endEx };
  }
  const a = toLocal(s, tz), b = toLocal(e, tz);
  if (!a || !b) return null;
  if (b.date < a.date || (b.date === a.date && b.min <= a.min)) return null;
  return { allDay: false, from: a, to: b };
}

/** One piece per weekend day a span touches: [{ d, from, to }] in minutes. */
function perDay(sp, days) {
  const out = [];
  for (const d of days) {
    if (!d || !DATE_ONLY.test(d.date || "")) continue;
    let from, to;
    if (sp.allDay) {
      const inRange = sp.toExclusiveDate
        ? d.date >= sp.startDate && d.date < sp.toExclusiveDate
        : d.date === sp.startDate;
      if (!inRange) continue;
      from = 0; to = 1440;
    } else {
      if (d.date < sp.from.date || d.date > sp.to.date) continue;
      from = d.date === sp.from.date ? sp.from.min : 0;
      to = d.date === sp.to.date ? sp.to.min : 1440;
      if (to <= from) continue;
    }
    out.push({ d, from, to });
  }
  return out;
}

function piece(p) {
  const allDay = p.from === 0 && p.to >= 1440;
  return { day: p.d.key, from: allDay ? null : hhmm(p.from), to: allDay ? null : hhmm(p.to), allDay };
}

/**
 * Cut raw calendar events to the weekend's days.
 * `days` is WEEKEND.days: [{ key, date }].
 */
export function busyForWeekend(raw, days) {
  if (!Array.isArray(raw) || !Array.isArray(days)) return [];
  const out = [];
  raw.slice(0, MAX_EVENTS).forEach((ev, i) => {
    if (!ev || typeof ev !== "object") return;
    const tz = knownZone(ev.timeZone);
    const away = !DATE_ONLY.test(String(ev.start)) && foreignAt(tz, ev.start);
    const sp = span(ev.start, ev.end, away ? tz : TZ);
    if (!sp) return;
    const id = clean(ev.id, 80).replace(/[^A-Za-z0-9_-]/g, "") || "ev" + i;
    const title = clean(ev.title, 120) || "Busy";
    const where = clean(ev.location, 160);
    const zone = away ? zoneName(tz, ev.start) : null;
    /* a neighbourhood and station mean something only at home */
    const hood = away ? "" : clean(ev.hood, 120);
    let loc = null;
    try { loc = hood ? parseHood(hood) : null; } catch (e) { loc = null; }
    for (const p of perDay(sp, days)) {
      const seg = { id: id + "~" + p.d.key, ...piece(p), title, where, zone };
      /* marked "free" in the calendar: an occasion to plan around (an
         anniversary, a birthday), not time that is taken */
      if (ev.free === true) seg.free = true;
      if (hood) seg.hood = hood;
      if (loc) seg.loc = loc;
      out.push(seg);
    }
  });
  return out;
}

/**
 * When the owner is out of town, per weekend day, in Montreal time.
 * `rawAway` is the refresh's own judgement ([{ start, end, where }]);
 * `rawBusy` adds every timed event kept on another clock. Overlapping
 * pieces on a day are merged.
 */
export function awayForWeekend(rawAway, rawBusy, days) {
  if (!Array.isArray(days)) return [];
  const pieces = [];
  const add = (s, e, where) => {
    const sp = span(s, e, TZ);
    if (!sp) return;
    for (const p of perDay(sp, days)) pieces.push({ ...p, where: clean(where, 80) });
  };
  (Array.isArray(rawAway) ? rawAway : []).slice(0, 20).forEach((a) => {
    if (a && typeof a === "object") add(a.start, a.end, a.where);
  });
  (Array.isArray(rawBusy) ? rawBusy : []).slice(0, MAX_EVENTS).forEach((ev) => {
    if (!ev || typeof ev !== "object" || DATE_ONLY.test(String(ev.start))) return;
    if (foreignAt(knownZone(ev.timeZone), ev.start)) add(ev.start, ev.end, ev.location);
  });

  const out = [];
  for (const d of days) {
    const mine = pieces.filter((p) => p.d === d).sort((a, b) => a.from - b.from);
    let cur = null;
    for (const p of mine) {
      if (cur && p.from <= cur.to) { cur.to = Math.max(cur.to, p.to); cur.where = cur.where || p.where; }
      else { if (cur) out.push(cur); cur = { ...p }; }
    }
    if (cur) out.push(cur);
  }
  return out.map((p) => ({ id: "away-" + p.d.key + "-" + p.from, ...piece(p), where: p.where }));
}

/** Whether the board may ask for a fresh read (api/calendar.js). */
export function canRefresh() {
  return !!(process.env.CALENDAR_ROUTINE_URL && process.env.CALENDAR_ROUTINE_TOKEN);
}
