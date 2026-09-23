/* A star is a like without a plan: something that should steer the
   highlights even if it never makes the weekend. It lands in the same
   taste profile an Add does, which is what the refresh reads.

   What is worth pinning down is the counting: a star toggled off and on
   is one like, a star on something already added is not a second one,
   and a device that has only starred must still win the sync against an
   empty profile. Lifted from index.html so what runs here is what ships. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build, html } from "./lift.mjs";

const blankTaste = build("blankTaste");
const tasteWeight = build("tasteWeight");
const WEEKEND = { id: "2026-09-12" };

function board(taste, items) {
  const saves = { n: 0 };
  const deps = { taste, WEEKEND, saveTaste: () => { saves.n++; } };
  deps.noteInterest = build("noteInterest", deps);
  deps.starLookup = (sk) => items[sk] || null;
  const recordStar = build("recordStar", deps);
  deps.lookupKey = (k) => items[k] || null;
  const recordAdd = build("recordAdd", deps);
  return { recordStar, recordAdd, saves };
}

const film = { kind: "event", item: { title: "The Little Prince", cat: "film", venue: "Cinéma Moderne" }, day: "sat" };
const fest = { kind: "standing", item: { title: "JACKALOPE", cat: "fest", venue: "Old Port", free: true }, away: false };

test("a star feeds the same profile an add does, marked as a star", () => {
  const t = blankTaste();
  board(t, { "sat|film|the-little-prince": film }).recordStar("sat|film|the-little-prince");
  assert.equal(t.totalStars, 1);
  assert.equal(t.totalAdds, 0);
  assert.equal(t.categories.film, 1);
  assert.equal(t.venues["Cinéma Moderne"], 1);
  assert.equal(t.recent[0].via, "star");
  assert.equal(t.recent[0].starred, true);
  assert.equal(t.recent[0].weekend, WEEKEND.id);
});

test("starring the same thing again this weekend counts once", () => {
  const t = blankTaste();
  const b = board(t, { "standing|jackalope": fest });
  b.recordStar("standing|jackalope");
  b.recordStar("standing|jackalope");
  assert.equal(t.totalStars, 1);
  assert.equal(t.categories.fest, 1);
  assert.equal(t.freeAdds, 1);
  assert.equal(t.recent.length, 1);
});

test("a star on something already added marks it rather than counting again", () => {
  const t = blankTaste();
  const b = board(t, { "sat|film|the-little-prince@09:30": film, "sat|film|the-little-prince": film });
  b.recordAdd("sat|film|the-little-prince@09:30");
  b.recordStar("sat|film|the-little-prince");
  assert.equal(t.totalAdds, 1);
  assert.equal(t.totalStars, 0);
  assert.equal(t.categories.film, 1);
  assert.equal(t.recent.length, 1);
  assert.equal(t.recent[0].via, "add");
  assert.equal(t.recent[0].starred, true);
});

test("a star last weekend does not stop a star this weekend", () => {
  const t = blankTaste();
  t.recent.push({ title: "JACKALOPE", weekend: "2026-09-05", via: "star", starred: true });
  board(t, { "standing|jackalope": fest }).recordStar("standing|jackalope");
  assert.equal(t.totalStars, 1);
  assert.equal(t.recent.length, 2);
});

test("an unknown star key records nothing", () => {
  const t = blankTaste();
  const b = board(t, {});
  b.recordStar("sat|film|gone");
  assert.equal(t.totalStars, 0);
  assert.equal(b.saves.n, 0);
});

test("the sync weighs stars as well as adds", () => {
  assert.equal(tasteWeight({ totalAdds: 2, totalStars: 3 }), 5);
  assert.equal(tasteWeight({ totalStars: 1 }), 1);
  assert.equal(tasteWeight(null), 0);
  assert.ok(html.includes("tasteWeight(t) >= tasteWeight(taste)"),
    "applyTaste should compare by tasteWeight, or a stars-only device loses its stars");
});
