/* Places the owner goes back to are one place however they are written, so
   a return trip finds the ledger the first one started. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeKey, canonicalPlace, KNOWN_PLACES } from "../lib/places.js";
import { cleanPlace, planWeek } from "../lib/plan.js";

const NY = { name: "New York", region: "NY", country: "USA", slug: "new-york-ny" };

test("placeKey is lowercase ascii with single spaces and no dots", () => {
  assert.equal(placeKey("N.Y.C."), "nyc");
  assert.equal(placeKey("  New   York, NY "), "new york ny");
  assert.equal(placeKey("Québec"), "quebec");
  assert.equal(placeKey(null), "");
});

test("every way of writing New York is the one place", () => {
  for (const name of ["NYC", "nyc", "N.Y.C.", "New York City", "New York", "Manhattan", "Brooklyn", "The Bronx"]) {
    assert.deepEqual(canonicalPlace({ name }), NY, name);
  }
  assert.deepEqual(canonicalPlace({ name: "Brooklyn", region: "NY", country: "United States" }), NY);
  assert.deepEqual(canonicalPlace({ name: "New York", region: "New York" }), NY);
});

test("a region or country that disagrees is another place", () => {
  assert.equal(canonicalPlace({ name: "Boston", region: "Lincolnshire", country: "UK" }), null);
  assert.equal(canonicalPlace({ name: "Toronto", region: "OH" }), null);
  assert.equal(canonicalPlace({ name: "Paris" }), null);
  assert.equal(canonicalPlace(null), null);
});

test("Washington needs its DC; a bare Washington is the state and is left alone", () => {
  assert.equal(canonicalPlace({ name: "Washington" }), null);
  assert.equal(canonicalPlace({ name: "Washington", region: "DC" }).slug, "washington-dc");
  assert.equal(canonicalPlace({ name: "DC" }).slug, "washington-dc");
});

test("the table's slugs are unique and valid", () => {
  const slugs = KNOWN_PLACES.map((k) => k.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.match(s, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test("cleanPlace files a known place under its fixed slug, whatever it was sent with", () => {
  const p = cleanPlace({ name: "NYC", slug: "nyc", lat: 40.71, lon: -74.0 });
  assert.deepEqual([p.name, p.region, p.country, p.slug, p.lat], ["New York", "NY", "USA", "new-york-ny", 40.71]);
});

test("the plan reads 'Trip to NYC' (three capitals are otherwise an airport code)", () => {
  const plan = (events, away = []) => planWeek(events, away, { today: "2026-09-09" });
  const p = plan([{ title: "Trip to NYC", start: "2026-09-12", end: "2026-09-14" }]);
  assert.equal(p.place.slug, "new-york-ny");
  assert.equal(p.placeSource, "title");
  assert.equal(plan([{ title: "Flight to YUL", start: "2026-09-12", end: "2026-09-14" }]).place, null, "airport codes still are");
});

test("evidence for one place under several names adds up", () => {
  const p = planWeek(
    [{ title: "Show", start: "2026-09-12T20:00:00-04:00", end: "2026-09-12T22:00:00-04:00", location: "Brooklyn, NY, USA" },
      { title: "Weekend in Boston", start: "2026-09-13", end: "2026-09-14" }],
    [{ start: "2026-09-12", end: "2026-09-13", where: "NYC" }],
    { today: "2026-09-09" });
  assert.equal(p.place.slug, "new-york-ny", "away NYC + Brooklyn location outweigh one day in Boston");
});
