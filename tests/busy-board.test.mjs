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
  const calendarVisible = (dk) => busy.filter((b) => b.day === dk);
  return build("clashesAt", { calendarVisible, mins, busyStart, busyEnd });
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

test("an entry kept on another clock is never compared with Montreal listings", () => {
  /* 20:10 PDT is 23:10 here; comparing the two clocks would be wrong
     either way, and the away piece around it already says it */
  const at = clashes([B({ from: "20:00", to: "21:00", zone: "PDT" })]);
  assert.equal(at({ day: "sat", dur: 60 }, "20:00").length, 0);
});

test("being away catches what falls inside it, in Montreal time", () => {
  const at = clashes([B({ away: true, from: "07:30", to: "24:00", title: "Out of town" })]);
  assert.equal(at({ day: "sat", dur: 60 }, "06:00").length, 0, "before you leave");
  assert.equal(at({ day: "sat", dur: 120 }, "06:30").length, 1, "running into the departure");
  assert.equal(at({ day: "sat", dur: 90 }, "19:30").length, 1);
});

const fmt = build("fmt");
const fmtClock = build("fmtClock", { fmt });
const busyWhen = build("busyWhen", { fmtClock });
const clashLine = build("clashLine", { busyWhen });
const clashSentence = build("clashSentence", { clashLine });

test("a trip in another zone is shown in that zone's time", () => {
  assert.equal(busyWhen(B({ from: "20:10", to: "20:30", zone: "PDT" })), "8:10 p.m. \u2013 8:30 p.m. PDT");
  assert.equal(busyWhen(B({ from: "10:00", to: "11:00", zone: null })), "10:00 a.m. \u2013 11:00 a.m.");
});

test("away reads as a stretch, and a clash with it says you are away", () => {
  const away = (o) => B({ away: true, title: "Out of town", where: "Revelstoke", ...o });
  assert.equal(busyWhen(away({ from: "07:30", to: "24:00" })), "From 7:30 a.m.");
  assert.equal(busyWhen(away({ from: "00:00", to: "15:00" })), "Until 3:00 p.m.");
  assert.equal(clashSentence(away({ from: "07:30", to: "24:00" })), "You\u2019re away then (Revelstoke)");
  assert.equal(clashSentence(away({ from: "07:30", to: "24:00" }), "7:00 p.m."),
    "The 7:00 p.m. is while you\u2019re away (Revelstoke)");
  assert.match(clashSentence(B({ from: "10:00", to: "11:00" })), /^Runs into \u201cDentist\u201d/);
});
