/* The owner's own calendar, cut to the weekend the board shows.

   The refresh reads Google Calendar and sends what it finds as BUSY, one
   entry per calendar event:

     { id, title, start, end, location? }

   `start` / `end` are either ISO datetimes with an offset
   ("2026-09-26T10:00:00-04:00") or, for an all-day event, bare dates
   ("2026-09-26") with `end` exclusive, which is how Google reports them.

   The board thinks in days and "HH:MM", so each event becomes one segment
   per weekend day it touches, in Montreal time:

     { id, day:"sat", from:"10:00", to:"14:00", allDay:false, title, where }

   A trip from Friday noon to Sunday night becomes three segments, and the
   middle one is all day. Anything outside the weekend is dropped. */

const TZ = "America/Toronto";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EVENTS = 100;

const localFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
});

/** A datetime as Montreal sees it: { date:"YYYY-MM-DD", min: minutes after midnight }. */
export function toLocal(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p = {};
  for (const part of localFmt.formatToParts(d)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + (+p.minute) };
}

function hhmm(m) {
  const h = Math.floor(m / 60), r = m % 60;
  return (h < 10 ? "0" : "") + h + ":" + (r < 10 ? "0" : "") + r;
}

function clean(s, max) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Local span of one event, or null if it cannot be read. */
function span(ev) {
  if (!ev || typeof ev !== "object") return null;
  const s = ev.start, e = ev.end || ev.start;
  if (typeof s !== "string" || typeof e !== "string") return null;
  if (DATE_ONLY.test(s)) {
    /* all day, end exclusive; a missing or equal end means one day */
    const endEx = DATE_ONLY.test(e) && e > s ? e : null;
    return { allDay: true, from: { date: s, min: 0 }, toExclusiveDate: endEx, startDate: s };
  }
  const a = toLocal(s), b = toLocal(e);
  if (!a || !b) return null;
  if (b.date < a.date || (b.date === a.date && b.min <= a.min)) return null;
  return { allDay: false, from: a, to: b };
}

/**
 * Cut raw calendar events to the weekend's days.
 * `days` is WEEKEND.days: [{ key, date }].
 */
export function busyForWeekend(raw, days) {
  if (!Array.isArray(raw) || !Array.isArray(days)) return [];
  const out = [];
  raw.slice(0, MAX_EVENTS).forEach((ev, i) => {
    const sp = span(ev);
    if (!sp) return;
    const id = clean(ev.id, 80).replace(/[^A-Za-z0-9_-]/g, "") || "ev" + i;
    const title = clean(ev.title, 120) || "Busy";
    const where = clean(ev.location, 160);
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
      const allDay = from === 0 && to >= 1440;
      out.push({
        id: id + "~" + d.key, day: d.key,
        from: allDay ? null : hhmm(from), to: allDay ? null : hhmm(to),
        allDay, title, where
      });
    }
  });
  return out;
}
