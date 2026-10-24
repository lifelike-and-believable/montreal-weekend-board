/* Two picks that overlap in the itinerary. A show against a show is a
   real conflict; a market against a show is only a smaller window at the
   market. Lifted from index.html so what runs here is what ships. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "./lift.mjs";

const esc = (s) => String(s);
const fmt = build("fmt");
const fmtClock = build("fmtClock", { fmt });
const fmtGap = build("fmtGap");
const pad = build("pad");
const isDropIn = build("isDropIn");
const overlapHtml = build("overlapHtml", { esc, fmtClock, fmtGap, pad, isDropIn });

const text = (h) => h.replace(/<[^>]+>/g, "");
const market = { title: "Found Fall Vintage Market", cat: "market", dur: 300 };
const show = { title: "Urinetown", cat: "theatre", dur: 150 };

test("a market around a show says how long is left at the market", () => {
  const h = overlapHtml(market, 12 * 60, show, 14 * 60);
  assert.ok(!h.includes("clash"), "not a warning");
  assert.equal(text(h),
    "Found Fall Vintage Market is drop-in until 5:00 p.m. — 2h before Urinetown, 30 min after it");
});

test("a show first, then a market already open, counts only the time after", () => {
  const h = overlapHtml(show, 11 * 60, market, 12 * 60);
  assert.ok(!h.includes("clash"));
  assert.equal(text(h), "Found Fall Vintage Market is drop-in until 5:00 p.m. — 3h 30m after Urinetown");
});

test("a market the show swallows whole is still a conflict", () => {
  const short = { ...market, dur: 120 };
  const h = overlapHtml(short, 14 * 60, show, 14 * 60);
  assert.ok(h.includes("clash"));
  assert.match(text(h), /one of these has to go/);
});

test("less than half an hour either side does not count as a visit", () => {
  const h = overlapHtml({ ...market, dur: 170 }, 13 * 60 + 40, show, 14 * 60);
  assert.ok(h.includes("clash"), "20 min before, 0 after");
});

test("two shows that overlap still have to lose one", () => {
  const film = { title: "Kindergarten", cat: "film", dur: 84 };
  const h = overlapHtml(film, 13 * 60 + 30, show, 14 * 60);
  assert.ok(h.includes("clash"));
  assert.equal(text(h), "⚠ Kindergarten runs about 54 min into Urinetown — one of these has to go");
});

test("two drop-ins at once are not a conflict", () => {
  const fest = { title: "Jackalope Fest", cat: "fest", dur: 360 };
  const h = overlapHtml(market, 12 * 60, fest, 13 * 60);
  assert.ok(!h.includes("clash"));
});
