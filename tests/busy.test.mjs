/* The refresh hands over the owner's calendar as Google reports it, and
   the board wants it per day in Montreal time. Where this goes wrong is
   at the edges: the offset, midnight, an all-day end that is exclusive,
   and a trip that spans the whole weekend. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { busyForWeekend, awayForWeekend, toLocal } from "../lib/busy.js";

const DAYS = [
  { key: "fri", date: "2026-09-25" },
  { key: "sat", date: "2026-09-26" },
  { key: "sun", date: "2026-09-27" }
];
const cut = (ev) => busyForWeekend([ev], DAYS);

test("a timed event lands on its day in Montreal time", () => {
  const [b] = cut({ id: "d", title: "Dentist", start: "2026-09-26T10:00:00-04:00", end: "2026-09-26T11:30:00-04:00", location: "Plateau" });
  assert.deepEqual(b, { id: "d~sat", day: "sat", from: "10:00", to: "11:30", allDay: false, title: "Dentist", where: "Plateau", zone: null });
});

test("a UTC timestamp is read in Montreal time, not the server's", () => {
  const [b] = cut({ id: "u", title: "Call", start: "2026-09-26T14:00:00Z", end: "2026-09-26T15:00:00Z" });
  assert.equal(b.from, "10:00");
  assert.equal(b.to, "11:00");
  /* clocks go back on Sunday 1 November 2026 */
  assert.deepEqual(toLocal("2026-10-31T14:00:00Z"), { date: "2026-10-31", min: 10 * 60 }, "EDT, UTC-4");
  assert.deepEqual(toLocal("2026-11-07T15:00:00Z"), { date: "2026-11-07", min: 10 * 60 }, "EST, UTC-5");
});

test("an all-day event covers its days, with Google's exclusive end", () => {
  const segs = cut({ id: "t", title: "Trip", start: "2026-09-26", end: "2026-09-28" });
  assert.deepEqual(segs.map((s) => [s.day, s.allDay, s.from, s.to]),
    [["sat", true, null, null], ["sun", true, null, null]]);
});

test("a one-day all-day event with no end is that day only", () => {
  assert.deepEqual(cut({ title: "Birthday", start: "2026-09-27" }).map((s) => s.day), ["sun"]);
});

test("a timed trip across the weekend is partial, whole, partial", () => {
  const segs = cut({ id: "q", title: "Quebec", start: "2026-09-25T12:00:00-04:00", end: "2026-09-27T20:00:00-04:00" });
  assert.deepEqual(segs.map((s) => [s.day, s.allDay, s.from, s.to]), [
    ["fri", false, "12:00", "24:00"],
    ["sat", true, null, null],
    ["sun", false, "00:00", "20:00"]
  ]);
});

test("an event ending at midnight does not spill onto the next day", () => {
  const segs = cut({ title: "Late", start: "2026-09-26T21:00:00-04:00", end: "2026-09-27T00:00:00-04:00" });
  assert.deepEqual(segs.map((s) => [s.day, s.to]), [["sat", "24:00"]]);
});

test("anything outside the weekend, or unreadable, is dropped", () => {
  assert.deepEqual(busyForWeekend([
    { title: "Monday", start: "2026-09-28T10:00:00-04:00", end: "2026-09-28T11:00:00-04:00" },
    { title: "Backwards", start: "2026-09-26T11:00:00-04:00", end: "2026-09-26T10:00:00-04:00" },
    { title: "Nonsense", start: "soon", end: "later" },
    null,
    "string"
  ], DAYS), []);
  assert.deepEqual(busyForWeekend("nope", DAYS), []);
});

test("titles and ids are tidied, and a blank title still says busy", () => {
  const [b] = cut({ id: "abc@google.com", title: "   ", start: "2026-09-26" });
  assert.equal(b.id, "abcgooglecom~sat");
  assert.equal(b.title, "Busy");
});

/* Travelling: the gig is shown in Revelstoke time, and being away is
   worked out in Montreal time, because that is what it is checked
   against. */
test("an event in another clock is cut and shown in that clock", () => {
  const segs = cut({ id: "p", title: "Performance", timeZone: "America/Vancouver",
    start: "2026-09-27T03:10:00Z", end: "2026-09-27T03:30:00Z" });
  assert.deepEqual(segs.map((s) => [s.day, s.from, s.to, s.zone]), [["sat", "20:10", "20:30", "PDT"]],
    "Saturday 8:10 p.m. there, though it is already Sunday here");
});

test("a zone that keeps Montreal's clock is home, and an unknown zone is ignored", () => {
  assert.equal(cut({ title: "NYC", timeZone: "America/New_York",
    start: "2026-09-26T10:00:00-04:00", end: "2026-09-26T11:00:00-04:00" })[0].zone, null);
  assert.equal(cut({ title: "Bad", timeZone: "Mars/Olympus",
    start: "2026-09-26T10:00:00-04:00", end: "2026-09-26T11:00:00-04:00" })[0].zone, null);
});

test("the refresh's own away spans are cut per day in Montreal time", () => {
  const away = awayForWeekend([{ start: "2026-09-25T07:30:00-04:00", end: "2026-09-28T09:00:00-04:00", where: "Revelstoke" }], [], DAYS);
  assert.deepEqual(away.map((a) => [a.day, a.allDay, a.from, a.to, a.where]), [
    ["fri", false, "07:30", "24:00", "Revelstoke"],
    ["sat", true, null, null, "Revelstoke"],
    ["sun", true, null, null, "Revelstoke"]
  ]);
});

test("an event in another clock counts as away even when the refresh sends none", () => {
  const away = awayForWeekend(undefined, [{ title: "Gig", timeZone: "America/Vancouver", location: "Revelstoke",
    start: "2026-09-26T18:00:00-07:00", end: "2026-09-26T22:00:00-07:00" }], DAYS);
  assert.deepEqual(away.map((a) => [a.day, a.from, a.to, a.where]), [["sat", "21:00", "24:00", "Revelstoke"], ["sun", "00:00", "01:00", "Revelstoke"]]);
});

test("overlapping away pieces on a day are one stretch", () => {
  const away = awayForWeekend([
    { start: "2026-09-26T09:00:00-04:00", end: "2026-09-26T13:00:00-04:00", where: "Quebec" },
    { start: "2026-09-26T12:00:00-04:00", end: "2026-09-26T18:00:00-04:00" }
  ], [], DAYS);
  assert.deepEqual(away.map((a) => [a.day, a.from, a.to, a.where]), [["sat", "09:00", "18:00", "Quebec"]]);
});

/* A Montreal location, written the way listings write `hood`, gets the
   same structure the listings get: métro dots on the board, and something
   for the itinerary to measure the next pick against. */
test("a hood on a calendar entry is read into loc, like a listing's", () => {
  const [b] = cut({ id: "l", title: "Lunch", location: "5240 av. du Parc",
    hood: "Mile End · métro Laurier",
    start: "2026-09-26T12:00:00-04:00", end: "2026-09-26T13:30:00-04:00" });
  assert.equal(b.hood, "Mile End · métro Laurier");
  assert.equal(b.loc.areaKey, "mile-end");
  assert.equal(b.loc.metro, "Laurier");
  assert.deepEqual(b.loc.lines, ["orange"]);
});

test("no hood, no loc; and none is kept for an entry on another clock", () => {
  const [plain] = cut({ title: "Call", start: "2026-09-26T10:00:00-04:00", end: "2026-09-26T11:00:00-04:00" });
  assert.equal(plain.hood, undefined);
  assert.equal(plain.loc, undefined);
  const [far] = cut({ title: "Gig", timeZone: "America/Vancouver", hood: "Mile End · métro Laurier",
    start: "2026-09-26T20:00:00-07:00", end: "2026-09-26T21:00:00-07:00" });
  assert.equal(far.hood, undefined, "a Montreal hood on a Revelstoke gig is a mistake, not a place");
});
