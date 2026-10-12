/* Which days to plan and where the owner will be. The traps: a one-hour
   "holiday party" is not a day off, a day off next month is not this week's,
   and the owner's home town is never a destination. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weekendFor, planWeek, parsePlace, placeSlug, cleanPlace, normalizeWeekend, DAY_OFF
} from "../lib/plan.js";

/* Wednesday 9 Sep 2026; the weekend is Sat 12 - Sun 13 */
const TODAY = "2026-09-09";
const allDay = (title, start, end, extra) => ({ title, start, end, ...extra });
const plan = (events, away = [], today = TODAY) => planWeek(events, away, { today });
const dates = (p) => p.days.map((d) => d.date);

test("the weekend is the next Saturday, or yesterday's on a Sunday", () => {
  assert.equal(weekendFor("2026-09-09"), "2026-09-12");
  assert.equal(weekendFor("2026-09-12"), "2026-09-12", "Saturday is the weekend");
  assert.equal(weekendFor("2026-09-13"), "2026-09-12", "Sunday: the weekend is still on");
  assert.equal(weekendFor("2026-09-14"), "2026-09-19");
  assert.throws(() => weekendFor("tomorrow"));
});

test("a bare week is just the weekend, in the contract's shape, opening Friday evening", () => {
  const p = plan([]);
  assert.deepEqual(p.days, [
    { key: "fri", date: "2026-09-11", name: "Friday", num: "Fri 11 Sep", kind: "weekend", evening: true },
    { key: "sat", date: "2026-09-12", name: "Saturday", num: "Sat 12 Sep", kind: "weekend" },
    { key: "sun", date: "2026-09-13", name: "Sunday", num: "Sun 13 Sep", kind: "weekend" }
  ]);
  assert.equal(p.label, "Friday 11 – Sunday 13 September 2026");
  assert.equal(p.place, null);
  assert.equal(p.placeSource, null);
  assert.deepEqual(p.weekend, { id: "2026-09-12", label: p.label, days: p.days });
});

test("today=Sunday plans the weekend that is still on", () => {
  const p = plan([], [], "2026-09-13");
  assert.equal(p.weekendId, "2026-09-12");
  assert.deepEqual(dates(p), ["2026-09-11", "2026-09-12", "2026-09-13"]);
});

test("Friday is evening-only unless it is a day off, when it is planned all day", () => {
  const fri = (p) => p.days.find((d) => d.key === "fri");
  assert.deepEqual([fri(plan([])).kind, fri(plan([])).evening], ["weekend", true]);
  const off = fri(plan([allDay("Day off", "2026-09-11", "2026-09-12")], [], "2026-09-09"));
  assert.equal(off.kind, "dayoff");
  assert.equal(off.evening, undefined);
});

test("an all-day PTO on Wednesday in the window is a day off", () => {
  const p = plan([allDay("PTO", "2026-09-16", "2026-09-17")], [], "2026-09-11");
  assert.deepEqual(p.dayOffs, [{ date: "2026-09-16", title: "PTO" }]);
  assert.deepEqual(p.days.map((d) => [d.key, d.kind]), [["fri", "weekend"], ["sat", "weekend"], ["sun", "weekend"], ["wed", "dayoff"]]);
  assert.equal(p.label, "Friday 11 – Sunday 13 September 2026 + Wednesday 16 September 2026 (day off)");
});

test("a day off outside the seven-day window is ignored", () => {
  assert.deepEqual(plan([allDay("Day off", "2026-09-17", "2026-09-18")]).dayOffs, []);
  assert.deepEqual(plan([allDay("Day off", "2026-09-08", "2026-09-09")]).dayOffs, [], "yesterday is past");
});

test("a long weekend (Fri + Mon) is one run", () => {
  const p = plan([allDay("Long weekend", "2026-09-11", "2026-09-12"), allDay("Vacation", "2026-09-14", "2026-09-15")]);
  assert.deepEqual(dates(p), ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"]);
  assert.equal(p.label, "Friday 11 – Monday 14 September 2026");
});

test("a one-hour holiday party is not a day off; a long timed block is", () => {
  const party = plan([{ title: "Holiday party", start: "2026-09-10T17:00:00-04:00", end: "2026-09-10T18:00:00-04:00" }]);
  assert.deepEqual(party.dayOffs, []);
  const day = plan([{ title: "Off work", start: "2026-09-10T09:00:00-04:00", end: "2026-09-10T17:00:00-04:00" }]);
  assert.deepEqual(day.dayOffs.map((d) => d.date), ["2026-09-10"]);
});

test("an ordinary all-day event is not a day off, an out-of-office one is", () => {
  assert.deepEqual(plan([allDay("Conference", "2026-09-10", "2026-09-11")]).dayOffs, []);
  assert.equal(plan([allDay("Away", "2026-09-10", "2026-09-11", { eventType: "outOfOffice" })]).dayOffs.length, 1);
  assert.equal(plan([allDay("Anything", "2026-09-10", "2026-09-11", { dayOff: true })]).dayOffs.length, 1);
});

test("the keyword list is one constant, and reads French", () => {
  for (const t of ["PTO", "Day off", "days off", "congé", "Out of Office", "ooo", "Bank holiday", "Personal day"]) {
    assert.ok(DAY_OFF.test(t), t);
  }
  assert.ok(!DAY_OFF.test("Photo shoot"), "pto only as a word");
});

test("a vacation over the weekend adds only its weekdays", () => {
  const p = plan([allDay("Vacation", "2026-09-10", "2026-09-15")]);
  assert.deepEqual(dates(p), ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"]);
});

test("a run crossing a month end is labelled with both months", () => {
  const p = plan([allDay("Vacation", "2026-10-30", "2026-11-03")], [], "2026-10-29");
  assert.equal(p.label, "Friday 30 October – Monday 2 November 2026");
});

test("a run crossing the new year is labelled with both years", () => {
  const p = plan([allDay("Vacation", "2026-12-31", "2027-01-02")], [], "2026-12-30");
  assert.equal(p.label, "Thursday 31 December 2026 – Sunday 3 January 2027");
});

/* ---- places ---- */

test("parsePlace reads addresses, regions and countries", () => {
  assert.deepEqual(parsePlace("Hotel Commonwealth, 500 Commonwealth Ave, Boston, MA 02215, USA"),
    { name: "Boston", region: "MA", country: "USA" });
  assert.deepEqual(parsePlace("Revelstoke, BC, Canada"), { name: "Revelstoke", region: "BC", country: "Canada" });
  assert.deepEqual(parsePlace("Paris, France"), { name: "Paris", country: "France" });
  assert.deepEqual(parsePlace("Burlington, Vermont"), { name: "Burlington", region: "Vermont" });
  assert.equal(parsePlace("Fenway Park"), null, "a bare segment could be a venue");
  assert.equal(parsePlace("500 Commonwealth Ave"), null);
  assert.deepEqual(parsePlace("Revelstoke", { trusted: true }), { name: "Revelstoke" });
});

test("placeSlug is ascii, lowercase and bounded", () => {
  assert.equal(placeSlug({ name: "Québec City", region: "QC", country: "Canada" }), "quebec-city-qc-canada");
  assert.equal(placeSlug({ name: "Zürich" }), "zurich");
  assert.ok(placeSlug({ name: "x".repeat(200) }).length <= 60);
});

test("cleanPlace sanitises and refuses home", () => {
  assert.equal(cleanPlace(null), null);
  assert.equal(cleanPlace({ name: "" }), null);
  assert.equal(cleanPlace({ name: "Montréal" }), null);
  assert.equal(cleanPlace({ name: "Boston", isHome: true }), null);
  const p = cleanPlace({ name: "Boston", region: "MA", lat: 42.36, lon: -71.06, tz: "America/New_York" });
  assert.deepEqual(p, { name: "Boston", region: "MA", slug: "boston-ma", lat: 42.36, lon: -71.06, tz: "America/New_York" });
  const odd = cleanPlace({ name: "Boston", lat: 400, lon: "x", tz: "Not/AZone", slug: "Bad Slug" });
  assert.deepEqual(odd, { name: "Boston", slug: "boston" });
  assert.equal(cleanPlace({ name: "n".repeat(300) }).name.length, 80);
});

test("an away span names the place, and a single word will do", () => {
  const p = plan([], [{ start: "2026-09-11", end: "2026-09-14", where: "Revelstoke" }]);
  assert.equal(p.place.name, "Revelstoke");
  assert.equal(p.placeSource, "away");
  assert.deepEqual(p.weekend.place, p.place);
});

test("a flight-to title names the place; an 'X trip' title does not", () => {
  const p = plan([allDay("Flight to Boston", "2026-09-12", "2026-09-14")]);
  assert.equal(p.place.name, "Boston");
  assert.equal(p.placeSource, "title");
  assert.equal(plan([allDay("Boston trip", "2026-09-12", "2026-09-14")]).place, null);
  assert.equal(plan([allDay("Flight to YUL", "2026-09-12", "2026-09-14")]).place, null, "airport code");
  assert.equal(plan([allDay("visit to boston", "2026-09-12", "2026-09-14")]).place, null, "needs a capital");
  assert.equal(plan([allDay("Weekend in Burlington with Sam", "2026-09-12", "2026-09-14")]).place.name, "Burlington");
});

test("an event location names the place, once it reads as one", () => {
  const ev = (location) => ({ title: "Show", start: "2026-09-12T20:00:00-04:00", end: "2026-09-12T22:00:00-04:00", location });
  const p = plan([ev("Hotel Commonwealth, 500 Commonwealth Ave, Boston, MA 02215, USA")]);
  assert.deepEqual([p.place.name, p.place.region, p.place.country, p.place.slug], ["Boston", "MA", "USA", "boston-ma-usa"]);
  assert.equal(p.placeSource, "location");
  assert.equal(plan([ev("Fenway Park")]).place, null);
});

test("anything in Montreal is home and ignored", () => {
  const ev = (location) => ({ title: "Gig", start: "2026-09-12T20:00:00-04:00", end: "2026-09-12T22:00:00-04:00", location });
  assert.equal(plan([ev("Bell Centre, 1909 Avenue des Canadiens, Montréal, QC, Canada")]).place, null);
  assert.equal(plan([ev("Montreal, QC")]).place, null);
  assert.equal(plan([], [{ start: "2026-09-12", end: "2026-09-14", where: "Montréal" }]).place, null);
  assert.equal(plan([allDay("Flight to Montreal", "2026-09-12", "2026-09-14")]).place, null);
});

test("the place covering most days wins; a tie goes to the earliest", () => {
  const tie = plan([], [
    { start: "2026-09-12", end: "2026-09-13", where: "Boston" },
    { start: "2026-09-13", end: "2026-09-14", where: "Providence" }
  ]);
  assert.equal(tie.place.name, "Boston", "tie: earliest");
  const maj = plan([allDay("Day off", "2026-09-11", "2026-09-12")], [
    { start: "2026-09-11", end: "2026-09-14", where: "Burlington" },
    { start: "2026-09-12", end: "2026-09-13", where: "Boston" }
  ]);
  assert.equal(maj.place.name, "Burlington");
});

test("a place outside the planned days is not evidence", () => {
  assert.equal(plan([], [{ start: "2026-09-20", end: "2026-09-22", where: "Boston" }]).place, null);
});

/* ---- normalizeWeekend ---- */

test("normalizeWeekend sorts, dedupes and fills", () => {
  const w = normalizeWeekend({
    id: "2026-09-12", extra: 1,
    days: [{ key: "sun", date: "2026-09-13" }, { key: "sat", date: "2026-09-12" }, { key: "sat", date: "2026-09-12" },
      { date: "2026-09-11" }, { date: "nope" }, null],
    place: { name: "Boston", region: "MA" }
  });
  assert.deepEqual(w.days.map((d) => [d.key, d.kind, d.name, d.num]), [
    ["fri", "dayoff", "Friday", "Fri 11 Sep"],
    ["sat", "weekend", "Saturday", "Sat 12 Sep"],
    ["sun", "weekend", "Sunday", "Sun 13 Sep"]
  ]);
  assert.equal(w.extra, 1);
  assert.equal(w.place.slug, "boston-ma");
  assert.equal(w.label, "Friday 11 – Sunday 13 September 2026");
});

test("normalizeWeekend drops a home place and refuses a week with no days", () => {
  const w = normalizeWeekend({ id: "x", days: [{ date: "2026-09-12" }], place: { name: "Montreal" } });
  assert.equal("place" in w, false);
  assert.equal(normalizeWeekend({ id: "x", days: [{ date: "bad" }] }), null);
  assert.equal(normalizeWeekend({ id: "x" }), null);
});
