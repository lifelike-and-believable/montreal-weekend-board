/* On the board, the calendar has two jobs: say what a showing runs into,
   and not mistake the owner's own picks (sent to Google Calendar from the
   itinerary) for something in their way. Lifted from index.html so what
   runs here is what ships. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "./lift.mjs";

const mins = build("mins");
const titleKey = build("titleKey");
const keysMatch = build("keysMatch");
const busyStart = build("busyStart", { mins });
const busyEnd = build("busyEnd", { mins });
const busyEcho = build("busyEcho", { titleKey, keysMatch });

const B = (o) => ({ id: "x~sat", day: "sat", allDay: false, title: "Dentist", where: "", ...o });

function clashes(busy) {
  const busyVisible = (dk) => busy.filter((b) => b.day === dk);
  return build("clashesAt", { busyVisible, mins, busyStart, busyEnd });
}

test("a showing runs into what overlaps it, for its length", () => {
  const at = clashes([B({ from: "10:30", to: "13:00" })]);
  const film = { day: "sat", dur: 100 };
  assert.equal(at(film, "09:00").length, 1, "9:00 for 100 min reaches 10:40");
  assert.equal(at(film, "08:00").length, 0, "8:00 is done by 9:40");
  assert.equal(at(film, "13:00").length, 0, "starting as it ends is fine");
  assert.equal(at({ day: "sat" }, "08:31").length, 1, "no dur means two hours");
  assert.equal(at({ day: "sun", dur: 60 }, "11:00").length, 0, "other days are other days");
});

test("an all-day entry catches everything that day, timed or not", () => {
  const at = clashes([B({ allDay: true, from: null, to: null, title: "Trip" })]);
  assert.equal(at({ day: "sat" }, "20:00").length, 1);
  assert.equal(at({ day: "sat" }, null).length, 1);
});

test("a timed entry never catches a showing with no time", () => {
  assert.equal(clashes([B({ from: "10:00", to: "12:00" })])({ day: "sat" }, null).length, 0);
});

test("a pick sent to the calendar is recognised as that listing", () => {
  const pool = [
    { day: "sat", title: "Hemela", sub: "VOSTA · with the director" },
    { day: "sat", title: "Tony", sub: "with Tony Hawk" },
    { title: "Jackalope Fest" },
    { day: "sun", title: "Bazar du CCA" }
  ];
  assert.equal(busyEcho(B({ title: "Hemela (VOSTA · with the director)" }), pool), true,
    "the title + Calendar gives it");
  assert.equal(busyEcho(B({ title: "Hemela" }), pool), true);
  assert.equal(busyEcho(B({ title: "Tony (with Tony Hawk)" }), pool), true, "a short title, by its full name");
  assert.equal(busyEcho(B({ title: "Tony's birthday" }), pool), false, "but not by a prefix");
  assert.equal(busyEcho(B({ title: "Jackalope Fest" }), pool), true, "a weekend-long card answers any day");
  assert.equal(busyEcho(B({ title: "Bazar du CCA" }), pool), false, "a listing on another day does not");
  assert.equal(busyEcho(B({ title: "Dentist" }), pool), false);
});
