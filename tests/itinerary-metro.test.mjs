/* The itinerary's place line carries the same métro dots the listings
   show, for picks and for calendar entries at home. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "./lift.mjs";

const esc = build("esc");
const hoodHtml = build("hoodHtml", { esc });
const slotHtml = build("slotHtml", {
  esc, hoodHtml, DAYMAP: {}, todayISO: () => "", nowMins: () => 0, mins: () => 0,
  titleLink: (item) => esc(item.title), clashSentence: () => "", mainClash: (c) => c[0],
  gcalUrl: () => "#",
});
const busySlotHtml = build("busySlotHtml", { esc, hoodHtml, fmtClock: (t) => t });

const loc = { metro: "Laurier", lines: ["orange"] };

test("a pick's venue line gets the station's dots", () => {
  const r = { item: { title: "Show", venue: "Casa del Popolo", hood: "Mile End · métro Laurier", loc } };
  const html = slotHtml("8 p.m.", r, r.item.venue, "", "k");
  assert.match(html, /Casa del Popolo · <span class="hood">Mile End · <span class="metro" title="orange line"><span class="mdots" aria-hidden="true"><span class="mdot is-orange"><\/span><\/span>métro Laurier<\/span><\/span>/);
});

test("a standing entry keeps its dates after the neighbourhood", () => {
  const r = { item: { title: "Expo", venue: "MAC", hood: "Quartier des spectacles · métro Laurier", loc } };
  const html = slotHtml("—", r, r.item.venue, "until 4 Jan", "k");
  assert.match(html, /métro Laurier<\/span><\/span> · until 4 Jan<\/span>/);
});

test("no hood, no stray separator", () => {
  const r = { item: { title: "Walk", region: "Laurentides" } };
  const html = slotHtml("trip", r, r.item.region, "Sat", "k");
  assert.match(html, /<span class="swhere">Laurentides · Sat<\/span>/);
});

test("a hood without line data is plain, escaped text", () => {
  const r = { item: { title: "X", venue: "V", hood: "A & B" } };
  assert.match(slotHtml("1", r, "V", "", "k"), /V · <span class="hood">A &amp; B<\/span>/);
});

test("a calendar entry at home shows dots; away does not", () => {
  const home = busySlotHtml({ title: "Dinner", from: "19:00", to: "21:00", hood: "Mile End · métro Laurier", loc });
  assert.match(home, /on your calendar · <span class="hood">.*mdot is-orange/);
  const away = busySlotHtml({ title: "Trip", away: true, allDay: true, where: "Revelstoke", hood: "Mile End · métro Laurier", loc });
  assert.doesNotMatch(away, /mdot/);
});
