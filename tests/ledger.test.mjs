/* What a place's ledger remembers besides its sources: the trips, a few
   travel notes, and what the owner picked while they were there. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addVisit, summarize, cleanGuide, mergeGuide, guideSize, personalFor, mergePersonal,
  MAX_VISITS, GUIDE_CAPS
} from "../lib/ledger.js";

const T0 = "2026-09-01T00:00:00.000Z", T1 = "2026-09-02T00:00:00.000Z";

test("a weekend counts as one visit however often it is recorded; the dates only widen", () => {
  let v = addVisit([], { weekendId: "2026-09-12", from: "2026-09-12", to: "2026-09-13", now: T0 });
  v = addVisit(v, { weekendId: "2026-09-12", from: "2026-09-11", to: "2026-09-13", now: T1 });
  assert.equal(v.length, 1);
  assert.deepEqual([v[0].from, v[0].to, v[0].at], ["2026-09-11", "2026-09-13", T0]);
});

test("visits are kept oldest first and bounded; junk is ignored", () => {
  let v = [];
  for (let i = 0; i < MAX_VISITS + 5; i++) {
    const d = new Date(Date.UTC(2020, 0, 4 + 7 * i)).toISOString().slice(0, 10);
    v = addVisit(v, { weekendId: d });
  }
  assert.equal(v.length, MAX_VISITS);
  assert.ok(v[0].weekendId < v[v.length - 1].weekendId);
  assert.deepEqual(addVisit(v, { weekendId: "soon" }), v);
  assert.deepEqual(addVisit(null, { weekendId: "2026-09-12" }).map((x) => x.weekendId), ["2026-09-12"]);
});

test("a first visit is one with no earlier trip, even on its own later runs", () => {
  const doc = { visits: [{ weekendId: "2026-09-12", from: "2026-09-12", to: "2026-09-13" }] };
  assert.equal(summarize(null, "2026-09-12").firstVisit, true);
  assert.equal(summarize(doc, "2026-09-12").firstVisit, true, "the same trip, a later run");
  const back = summarize(doc, "2026-10-17");
  assert.deepEqual([back.firstVisit, back.visits, back.firstVisitedAt, back.lastVisitedAt], [false, 1, "2026-09-12", "2026-09-13"]);
});

test("the guide keeps short, named notes per section, without repeats, within each cap", () => {
  const g = cleanGuide({
    areas: [{ name: "Williamsburg", note: "Bars and venues, L train" }, { name: "williamsburg", note: "dup" }, "  ", null],
    tips: Array.from({ length: GUIDE_CAPS.tips + 5 }, (_, i) => `tip ${i}`),
    nonsense: [{ note: "ignored" }]
  }, T0);
  assert.equal(g.areas.length, 1);
  assert.equal(g.tips.length, GUIDE_CAPS.tips);
  assert.equal(g.tips[g.tips.length - 1].note, `tip ${GUIDE_CAPS.tips + 4}`, "the newest are kept");
  assert.equal(g.nonsense, undefined);
  assert.deepEqual(g.transit, []);
  assert.equal(cleanGuide(null).areas.length, 0);
});

test("merging a note with the same name replaces it; remove takes it out", () => {
  let g = mergeGuide({}, { areas: [{ name: "Chelsea", note: "galleries" }], transit: ["Penn Station for the train"] }, { now: T0 });
  g = mergeGuide(g, { areas: [{ name: "CHELSEA", note: "galleries, the High Line" }] }, { now: T1 });
  assert.equal(g.areas.length, 1);
  assert.equal(g.areas[0].note, "galleries, the High Line");
  assert.equal(guideSize(g), 2);
  g = mergeGuide(g, {}, { remove: { transit: ["penn station for the train"], areas: ["Nowhere"] }, now: T1 });
  assert.deepEqual([g.transit.length, g.areas.length], [0, 1]);
});

test("a neighbourhood note has room for a couple of sentences; the others stay at one", () => {
  const long = "x".repeat(500);
  const g = cleanGuide({ hoods: [{ name: "Greenpoint", note: long }], tips: [long] }, T0);
  assert.equal(g.hoods[0].note.length, 420);
  assert.equal(g.tips[0].note.length, 240);
  const many = Array.from({ length: GUIDE_CAPS.hoods + 3 }, (_, i) => ({ name: `Hood ${i}`, note: "n" }));
  assert.equal(cleanGuide({ hoods: many }, T0).hoods.length, GUIDE_CAPS.hoods);
});

test("a neighbourhood note is corrected by name and removed by name, like any other", () => {
  let g = mergeGuide({}, { hoods: [{ name: "Greenpoint", note: "old" }] }, { now: T0 });
  g = mergeGuide(g, { hoods: [{ name: "greenpoint", note: "new" }] }, { now: T1 });
  assert.deepEqual(g.hoods.map((h) => h.note), ["new"]);
  assert.equal(mergeGuide(g, {}, { remove: { hoods: ["GREENPOINT"] }, now: T1 }).hoods.length, 0);
});

test("personal notes are the owner's adds and stars for that weekend; a hide never appears", () => {
  const taste = { recent: [
    { title: "Hadestown", cat: "theatre", venue: "Walter Kerr", weekend: "2026-09-12", via: "add", at: T0 },
    { title: "Jazz at the Vanguard", cat: "music", venue: "Village Vanguard", weekend: "2026-09-12", via: "star", starred: true, at: T1 },
    { title: "Something at home", cat: "film", venue: "Cinéma Moderne", weekend: "2026-09-19", via: "add", at: T1 },
    null
  ] };
  const n = personalFor(taste, "2026-09-12");
  assert.deepEqual(n.map((x) => [x.title, x.via]), [["Hadestown", "add"], ["Jazz at the Vanguard", "star"]]);
  assert.deepEqual(personalFor({}, "2026-09-12"), []);
  assert.deepEqual(personalFor(null, "2026-09-12"), []);
});

test("merging personal notes is idempotent, upgrades an add to a star, and lists the newest first", () => {
  const a = { title: "Hadestown", weekend: "2026-09-12", via: "add", at: T0 };
  const once = mergePersonal([], [a]);
  assert.deepEqual(mergePersonal(once, [a]), once);
  const starred = mergePersonal(once, [{ ...a, via: "star", at: T1 }]);
  assert.equal(starred.length, 1);
  assert.deepEqual([starred[0].via, starred[0].at], ["star", T0], "keeps when it was first noted");
  const two = mergePersonal(starred, [{ title: "Other", weekend: "2026-09-12", via: "add", at: T1 }]);
  assert.equal(two[0].title, "Other");
});

test("the plan summary hands back earlier trips' notes, not this trip's own", () => {
  const doc = { visits: [{ weekendId: "2026-09-12", from: "2026-09-12", to: "2026-09-13" }],
    personal: [{ title: "Hadestown", weekend: "2026-09-12", via: "star", at: T0 }, { title: "Now", weekend: "2026-10-17", via: "add", at: T1 }] };
  assert.deepEqual(summarize(doc, "2026-10-17").personal.map((p) => p.title), ["Hadestown"]);
});
