/* A poster you photographed sits on the board beside the refreshed
   listings, and adding it to your plan has to put it in the itinerary
   like anything else. lookupKey is what turns a pick into an itinerary
   line, so it has to find posters too. Lifted from index.html so what
   runs here is what ships. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "./lift.mjs";

const evId = build("evId");
const key = build("key", { evId });

function lookup({ events = [], standing = [], afield = [], spotted = { events: [], standing: [] } }) {
  return build("lookupKey", {
    EVENTS: events, STANDING: standing, AFIELD: afield, evId,
    splitSpotted: () => spotted
  });
}

const listing = { day: "sat", cat: "film", title: "Death by Hanging", times: ["20:15"] };
const poster = { day: "sat", cat: "music", title: "Jazz in the Park", times: ["19:00"], spotted: true };
const posterRun = { id: "spot-p1", cat: "fest", title: "Gardens of Light", spotted: true };

test("a refreshed listing still resolves", () => {
  const r = lookup({ events: [listing] })(key(listing, "20:15"));
  assert.equal(r.kind, "event");
  assert.equal(r.item, listing);
  assert.equal(r.time, "20:15");
  assert.equal(r.day, "sat");
});

test("a captured poster on one day resolves, so it reaches the itinerary", () => {
  const r = lookup({ events: [listing], spotted: { events: [poster], standing: [] } })(key(poster, "19:00"));
  assert.ok(r, "poster pick was not found");
  assert.equal(r.item, poster);
  assert.equal(r.time, "19:00");
  assert.equal(r.day, "sat");
});

test("a poster with no time resolves as a time-TBC pick", () => {
  const untimed = { ...poster, times: [] };
  const r = lookup({ spotted: { events: [untimed], standing: [] } })(key(untimed, null));
  assert.ok(r);
  assert.equal(r.time, null);
});

test("a multi-day poster resolves from the running-all-weekend pool", () => {
  const r = lookup({ spotted: { events: [], standing: [posterRun] } })("standing|spot-p1@tba");
  assert.ok(r);
  assert.equal(r.kind, "standing");
  assert.equal(r.item, posterRun);
  assert.equal(r.away, false);
});

test("a pick for something no longer on the board resolves to nothing", () => {
  assert.equal(lookup({})("sat|film|gone@20:00"), null);
  assert.equal(lookup({})("standing|spot-gone@tba"), null);
});
