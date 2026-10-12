/* Which days the board plans, and where the owner will be for them.

   The weekend is Saturday and Sunday. A day off in the coming week (a
   Wednesday "PTO" on the calendar) is treated like a weekend day and gets
   listings too. And when the calendar shows those days are spent
   somewhere else, the listings are for there, not Montreal.

   The external routine reads Google Calendar and cannot be trusted to
   apply these rules the same way twice, so they live here, pure and
   tested: the routine sends the raw events to POST /api/trip and gets
   back the days and the place to generate for.

   WEEKEND = { id, label, updated, days:[{key,date,name,num,kind}], place? }
     id     the Saturday's ISO date
     kind   "weekend" (Sat/Sun) or "dayoff" (Mon-Fri)
     place  only when away: { name, region?, country?, slug, lat?, lon?, tz? }
            absent means home (Montreal)

   No I/O in this file. */

import { span, perDay, knownZone } from "./busy.js";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const MAX_EVENTS = 100;
const MIN_DAY_OFF_MIN = 6 * 60;

/** What a title must say for an event to mean "the owner is not working that day".
    Single constant on purpose: this is the list to edit. Unicode-aware
    boundaries, since \b does not see the é in "congé". */
export const DAY_OFF = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:days? off|off work|pto|time off|vacation|holiday|ooo|out of office|" +
  "personal day|cong[ée]|bank holiday|long weekend)(?![\\p{L}\\p{N}])", "iu");

/* ---- dates ---------------------------------------------------------- */

const validDate = (s) => typeof s === "string" && DATE_ONLY.test(s) &&
  !isNaN(Date.parse(s + "T00:00:00Z")) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const utc = (iso) => new Date(iso + "T00:00:00Z");
export const addDays = (iso, n) => new Date(utc(iso).getTime() + n * 86400000).toISOString().slice(0, 10);
const dowOf = (iso) => utc(iso).getUTCDay();

/** The Saturday of the weekend being planned: the next one on or after
    today, or yesterday's if today is Sunday (the weekend is still on). */
export function weekendFor(todayISO) {
  if (!validDate(todayISO)) throw new Error("today must be YYYY-MM-DD");
  const d = dowOf(todayISO);
  return d === 0 ? addDays(todayISO, -1) : addDays(todayISO, 6 - d);
}

function dayRecord(date) {
  const d = utc(date), dow = d.getUTCDay();
  return {
    key: KEYS[dow], date, name: DAYS[dow],
    num: `${DAYS[dow].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`,
    kind: dow === 0 || dow === 6 ? "weekend" : "dayoff"
  };
}

function runLabel(a, b) {
  const da = utc(a), db = utc(b);
  const head = (d) => `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
  const full = (d) => `${head(d)} ${MONTHS[d.getUTCMonth()]}`;
  if (a === b) return `${full(da)} ${da.getUTCFullYear()}`;
  if (da.getUTCFullYear() !== db.getUTCFullYear()) {
    return `${full(da)} ${da.getUTCFullYear()} – ${full(db)} ${db.getUTCFullYear()}`;
  }
  if (da.getUTCMonth() !== db.getUTCMonth()) return `${full(da)} – ${full(db)} ${db.getUTCFullYear()}`;
  return `${head(da)} – ${head(db)} ${MONTHS[db.getUTCMonth()]} ${db.getUTCFullYear()}`;
}

/** "Saturday 12 – Sunday 13 September 2026"; separate runs joined with " + ";
    a run made only of days off is suffixed " (day off)". */
export function labelFor(days) {
  const sorted = [...days].sort((x, y) => (x.date < y.date ? -1 : 1));
  const runs = [];
  for (const d of sorted) {
    const cur = runs[runs.length - 1];
    if (cur && addDays(cur.end, 1) === d.date) { cur.end = d.date; cur.kinds.add(d.kind); }
    else runs.push({ start: d.date, end: d.date, kinds: new Set([d.kind]) });
  }
  return runs.map((r) => runLabel(r.start, r.end) + (r.kinds.has("weekend") ? "" : " (day off)")).join(" + ");
}

/* ---- places --------------------------------------------------------- */

const COUNTRIES = new Map(Object.entries({
  "usa": "USA", "us": "USA", "u.s.a.": "USA", "u.s.": "USA", "united states": "USA",
  "united states of america": "USA", "uk": "UK", "u.k.": "UK", "united kingdom": "UK",
  "england": "England", "scotland": "Scotland", "wales": "Wales", "canada": "Canada",
  "france": "France", "germany": "Germany", "italy": "Italy", "spain": "Spain",
  "portugal": "Portugal", "ireland": "Ireland", "netherlands": "Netherlands",
  "belgium": "Belgium", "switzerland": "Switzerland", "austria": "Austria",
  "mexico": "Mexico", "japan": "Japan", "china": "China", "australia": "Australia",
  "new zealand": "New Zealand", "iceland": "Iceland", "norway": "Norway", "sweden": "Sweden",
  "denmark": "Denmark", "finland": "Finland", "greece": "Greece", "poland": "Poland",
  "czechia": "Czechia", "czech republic": "Czechia", "hungary": "Hungary", "cuba": "Cuba",
  "brazil": "Brazil", "argentina": "Argentina", "india": "India", "morocco": "Morocco",
  "croatia": "Croatia", "turkey": "Turkey", "south korea": "South Korea", "thailand": "Thailand"
}));

const REGION_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
  "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
  "virginia", "washington", "west virginia", "wisconsin", "wyoming",
  "alberta", "british columbia", "manitoba", "new brunswick", "newfoundland and labrador",
  "nova scotia", "ontario", "prince edward island", "quebec", "québec", "saskatchewan"
]);

const STREET_END = /\b(?:ave|avenue|st|street|rd|road|blvd|boulevard|dr|drive|way|lane|ln|rue|pkwy|parkway|hwy|highway|ct|court|terrace|ter)\.?$/i;
const ZIP = /\b\d{5}(?:-\d{4})?\b|\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/gi;
const HOME = /montr[eé]al/i;

/** Raw text that places the owner at home. */
export const isHomeText = (s) => HOME.test(String(s || "").normalize("NFC"));

const squash = (s, max) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);

/**
 * "Hotel Commonwealth, 500 Commonwealth Ave, Boston, MA 02215, USA"
 *   -> { name:"Boston", region:"MA", country:"USA" }
 * Untrusted text (a calendar event's location) that is one bare segment
 * could be a venue ("Fenway Park"), so it is not a place. Trusted text
 * (an AWAY `where`) may be one word.
 */
export function parsePlace(str, { trusted = false } = {}) {
  if (typeof str !== "string") return null;
  let segs = str.split(",").map((s) => squash(s, 120)).filter(Boolean);
  segs = segs.filter((s) => !/^\d/.test(s) && !STREET_END.test(s));
  segs = segs.map((s) => squash(s.replace(ZIP, ""), 120)).filter(Boolean);
  if (!segs.length || (!trusted && segs.length < 2)) return null;

  let country;
  const c = COUNTRIES.get(segs[segs.length - 1].toLowerCase());
  if (c) { country = c; segs.pop(); }

  let region;
  if (segs.length >= 2) {
    const last = segs[segs.length - 1];
    if (/^[A-Z]{2}$/.test(last) || REGION_NAMES.has(last.toLowerCase())) { region = last; segs.pop(); }
  }
  const name = segs[segs.length - 1];
  if (!name || !/\p{L}/u.test(name)) return null;
  const out = { name: name.slice(0, 80) };
  if (region) out.region = region.slice(0, 40);
  if (country) out.country = country;
  return out;
}

const ascii = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** ascii, lowercase, hyphenated; at most 60 characters. */
export function placeSlug(p) {
  const raw = [p && p.name, p && p.region, p && p.country].filter(Boolean).join(" ");
  return ascii(raw).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}

/** A place safe to store and show, or null (no name, or it is home). */
export function cleanPlace(p) {
  if (!p || typeof p !== "object" || p.isHome === true) return null;
  const name = squash(p.name, 80);
  if (!name || isHomeText(name)) return null;
  const out = { name };
  const region = squash(p.region, 40), country = squash(p.country, 60);
  if (region) out.region = region;
  if (country) out.country = country;
  const given = typeof p.slug === "string" ? p.slug : "";
  out.slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(given) && given.length <= 60 ? given : placeSlug(out);
  if (!out.slug) return null;
  if (typeof p.lat === "number" && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90) out.lat = p.lat;
  if (typeof p.lon === "number" && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180) out.lon = p.lon;
  const tz = knownZone(p.tz);
  if (tz) out.tz = tz;
  return out;
}

const TRIP_WORD = /\b(?:trip|flight|train|drive|road trip|visit|weekend|stay|vacation|holiday|getaway|hotel|airbnb|travel)\s+(?:to|in|for)\s+/i;
const NAME_STOP = new Set(["With", "And", "For", "On", "At", "From", "Via", "Then", "Return", "Back"]);
const NOT_PLACES = new Set(["Work", "Fun", "Me", "Us", "Mom", "Dad", "Dinner", "Lunch", "Brunch", "Breakfast"]);
const LOWER_JOIN = new Set(["de", "du", "la", "le", "of", "des", "del", "di", "von", "van"]);

/** "Flight to Boston", "Weekend in Burlington, VT" -> a place. Only the
    keyword + to/in/for + Capitalised Name form; "Boston trip" is not read. */
function placeFromTitle(title) {
  const m = TRIP_WORD.exec(String(title || ""));
  if (!m) return null;
  const rest = String(title).slice(m.index + m[0].length);
  const toks = rest.split(/\s+/);
  const words = [];
  for (let i = 0; i < toks.length && words.length < 4; i++) {
    const t = toks[i].replace(/[.,;:!)]+$/, "");
    const lower = LOWER_JOIN.has(t) && words.length && /^\p{Lu}/u.test(toks[i + 1] || "");
    if (lower) { words.push(t); continue; }
    if (!/^\p{Lu}[\p{L}'’.-]*$/u.test(t) || NAME_STOP.has(t)) break;
    words.push(t);
    if (/[,;:!)]$/.test(toks[i])) break;
  }
  const name = words.join(" ");
  if (!name || /^[A-Z]{3}$/.test(name) || NOT_PLACES.has(name) || isHomeText(name)) return null;
  const out = { name };
  const reg = /^,\s*([A-Z]{2})\b/.exec(rest.slice(rest.indexOf(words[words.length - 1]) + words[words.length - 1].length));
  if (reg) out.region = reg[1];
  return out;
}

/* ---- the week ------------------------------------------------------- */

const SRC_RANK = { away: 3, location: 2, title: 1 };

function covers(ev, dayObjs) {
  const sp = span(ev.start, ev.end);
  return sp ? perDay(sp, dayObjs).map((p) => p.d.date) : [];
}

/**
 * Cut a week's raw calendar events to the days to plan and the place.
 * rawEvents: [{ title, start, end, location?, eventType?, dayOff? }]
 * rawAway:   [{ start, end, where|place }]
 */
export function planWeek(rawEvents, rawAway, { today } = {}) {
  const weekendId = weekendFor(today);
  const events = (Array.isArray(rawEvents) ? rawEvents : []).slice(0, MAX_EVENTS)
    .filter((e) => e && typeof e === "object");
  const aways = (Array.isArray(rawAway) ? rawAway : []).slice(0, 50)
    .filter((a) => a && typeof a === "object");

  /* day off: Mon-Fri in [today, today+6] under an event that both is
     day-shaped and says so */
  const candidates = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i), dow = dowOf(date);
    if (dow >= 1 && dow <= 5) candidates.push({ date });
  }
  const offTitle = new Map();
  for (const ev of events) {
    const title = squash(ev.title || ev.summary, 120);
    const ooo = ev.eventType === "outOfOffice", flag = ev.dayOff === true;
    if (!(DAY_OFF.test(title) || ooo || flag)) continue;
    const sp = span(ev.start, ev.end);
    if (!sp) continue;
    const dayShaped = sp.allDay || ooo || flag ||
      (sp.from.date === sp.to.date && sp.to.min - sp.from.min >= MIN_DAY_OFF_MIN);
    if (!dayShaped) continue;
    for (const p of perDay(sp, candidates)) {
      if (!offTitle.has(p.d.date)) offTitle.set(p.d.date, title || "Day off");
    }
  }

  /* The weekend has always opened on Friday evening. Unless Friday is a
     day off (then it is planned all day), it is a weekend day marked
     `evening`: research from about 5 p.m. */
  const friday = addDays(weekendId, -1);
  const dates = new Set([friday, weekendId, addDays(weekendId, 1), ...offTitle.keys()]);
  const days = [...dates].sort().map((date) => {
    const rec = dayRecord(date);
    if (date === friday && !offTitle.has(date)) return { ...rec, kind: "weekend", evening: true };
    /* the event that made it a day off, so the board does not show it twice */
    return offTitle.has(date) ? { ...rec, title: offTitle.get(date) } : rec;
  });
  const label = labelFor(days);
  const dayOffs = days.filter((d) => d.kind === "dayoff").map((d) => ({ date: d.date, title: offTitle.get(d.date) }));

  /* place: whichever candidate covers most of the included days */
  const dayObjs = days.map((d) => ({ date: d.date }));
  const found = new Map();
  const note = (raw, ds, src) => {
    if (!raw || !ds.length) return;
    const key = ascii(raw.name);
    const f = found.get(key) || { place: {}, dates: new Set(), src: 0 };
    f.place = { ...raw, ...f.place, ...(raw.region && !f.place.region ? { region: raw.region } : {}),
      ...(raw.country && !f.place.country ? { country: raw.country } : {}) };
    ds.forEach((x) => f.dates.add(x));
    f.src = Math.max(f.src, SRC_RANK[src]);
    found.set(key, f);
  };
  for (const a of aways) {
    const where = String(a.where || a.place || "");
    if (isHomeText(where)) continue;
    const p = parsePlace(where, { trusted: true });
    if (p && !isHomeText(p.name)) note(p, covers(a, dayObjs), "away");
  }
  for (const ev of events) {
    const ds = covers(ev, dayObjs);
    if (!ds.length) continue;
    const loc = String(ev.location || "");
    if (loc && !isHomeText(loc)) {
      const p = parsePlace(loc);
      if (p && !isHomeText(p.name)) note(p, ds, "location");
    }
    const t = placeFromTitle(ev.title || ev.summary);
    if (t) note(t, ds, "title");
  }

  let best = null;
  for (const f of found.values()) {
    const first = [...f.dates].sort()[0];
    if (!best || f.dates.size > best.n || (f.dates.size === best.n &&
        (first < best.first || (first === best.first && f.src > best.f.src)))) {
      best = { f, n: f.dates.size, first };
    }
  }
  const place = best ? cleanPlace(best.f.place) : null;
  const placeSource = place ? ["title", "location", "away"][best.f.src - 1] : null;

  const weekend = { id: weekendId, label, days };
  if (place) weekend.place = place;
  return { today, weekendId, days, label, dayOffs, place, placeSource, weekend };
}

/**
 * A WEEKEND block in the contract's shape: days sorted and unique with
 * name/num/kind filled, place cleaned. null when no day is usable.
 * Everything else on it is kept.
 */
export function normalizeWeekend(w) {
  if (!w || typeof w !== "object" || !Array.isArray(w.days)) return null;
  const byDate = new Map(), keys = new Set();
  for (const d of w.days) {
    if (!d || typeof d !== "object" || !validDate(d.date) || byDate.has(d.date)) continue;
    const base = dayRecord(d.date);
    const rec = { ...d, key: base.key, date: d.date };
    rec.name = typeof d.name === "string" && d.name ? d.name : base.name;
    rec.num = typeof d.num === "string" && d.num ? d.num : base.num;
    rec.kind = d.kind === "weekend" || d.kind === "dayoff" ? d.kind : base.kind;
    if (keys.has(rec.key)) continue;
    keys.add(rec.key);
    byDate.set(d.date, rec);
  }
  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!days.length) return null;
  const out = { ...w, days };
  if (typeof out.label !== "string" || !out.label) out.label = labelFor(days);
  const place = cleanPlace(w.place);
  if (place) out.place = place; else delete out.place;
  return out;
}
