/* The refresh hands over the owner's calendar as Google reports it, and
   the board wants it per day in Montreal time. Where this goes wrong is
   at the edges: the offset, midnight, an all-day end that is exclusive,
   and a trip that spans the whole weekend. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { busyForWeekend, toLocal } from "../lib/busy.js";

const DAYS = [
  { key: "fri", date: "2026-09-25" },
  { key: "sat", date: "2026-09-26" },
  { key: "sun", date: "2026-09-27" }
];
const cut = (ev) => busyForWeekend([ev], DAYS);

test("a timed event lands on its day in Montreal time", () => {
  const [b] = cut({ id: "d", title: "Dentist", start: "2026-09-26T10:00:00-04:00", end: "2026-09-26T11:30:00-04:00", location: "Plateau" });
  assert.deepEqual(b, { id: "d~sat", day: "sat", from: "10:00", to: "11:30", allDay: false, title: "Dentist", where: "Plateau" });
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
