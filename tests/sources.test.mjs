/* The per-place source list: what is kept, what sinks, what is dropped. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const url = (p) => new URL("../" + p, import.meta.url).href;
const DOCS = new Map();
mock.module(url("lib/store.js"), {
  namedExports: {
    getDoc: async (p) => DOCS.get(p) || null,
    setDoc: async (p, d) => { DOCS.set(p, JSON.parse(JSON.stringify(d))); return true; }
  }
});

const { normalizeUrl, cleanSource, mergeSources, rankSources, getSources, saveSources, MAX_PER_PLACE } =
  await import(url("lib/sources.js"));

const NOW = "2026-09-10T12:00:00.000Z";
const src = (host, extra) => ({ url: `https://${host}/`, name: host, ...extra });

test("urls are normalised, and only https survives", () => {
  assert.equal(normalizeUrl("https://Example.COM/Events/?utm_source=x&page=2#top"), "https://example.com/Events?page=2");
  assert.equal(normalizeUrl("https://example.com/"), "https://example.com");
  assert.equal(normalizeUrl("http://example.com"), null);
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("not a url"), null);
});

test("cleanSource clamps and defaults", () => {
  const s = cleanSource({ url: "https://a.com/x/", name: "n".repeat(200), kind: "bogus",
    covers: ["Music", "music", "bad id!", ...Array(10).fill(0).map((_, i) => "c" + i)], note: "z".repeat(500), uses: -3 }, NOW);
  assert.equal(s.url, "https://a.com/x");
  assert.equal(s.name.length, 80);
  assert.equal(s.kind, "other");
  assert.equal(s.covers.length, 8);
  assert.equal(s.covers[0], "music");
  assert.equal(s.note.length, 200);
  assert.deepEqual([s.addedAt, s.lastUsedAt, s.uses, s.misses], [NOW, null, 0, 0]);
  assert.equal(cleanSource({ url: "http://a.com" }), null);
});

test("merge dedupes by normalised url and keeps the stats", () => {
  const first = mergeSources([], [src("a.com", { kind: "press" }), { url: "https://A.com?utm_x=1", name: "dup" }], { now: NOW });
  assert.equal(first.length, 1);
  const again = mergeSources(first, [src("a.com", { note: "fresh" })], { used: ["https://a.com/"], now: "2026-09-11T00:00:00Z" });
  assert.equal(again.length, 1);
  assert.deepEqual([again[0].uses, again[0].lastUsedAt, again[0].note, again[0].kind, again[0].addedAt],
    [1, "2026-09-11T00:00:00Z", "fresh", "press", NOW]);
});

test("used raises uses, dead raises misses, unknown urls are ignored", () => {
  const list = mergeSources([], [src("a.com"), src("b.com")], { now: NOW });
  const next = mergeSources(list, [], { used: ["https://a.com", "https://nope.com"], dead: ["https://b.com"], now: NOW });
  const by = Object.fromEntries(next.map((s) => [s.name, s]));
  assert.deepEqual([by["a.com"].uses, by["a.com"].misses, by["b.com"].uses, by["b.com"].misses], [1, 0, 0, 1]);
  assert.equal(next.length, 2);
});

test("rank is uses - 2*misses, and a source that keeps failing sinks, flagged dead", () => {
  const mk = (name, uses, misses) => ({ ...cleanSource(src(name), NOW), uses, misses });
  const ranked = rankSources([mk("dead.com", 0, 3), mk("low.com", 1, 0), mk("high.com", 5, 1), mk("ok-fail.com", 4, 3)]);
  assert.deepEqual(ranked.map((s) => s.name), ["high.com", "low.com", "ok-fail.com", "dead.com"]);
  assert.deepEqual(ranked.map((s) => s.status), [undefined, undefined, undefined, "dead"]);
  const sunk = rankSources([mk("dead.com", 1, 5), mk("meh.com", 0, 1)]);
  assert.deepEqual(sunk.map((s) => s.name), ["meh.com", "dead.com"], "dead even though its score ties or beats nothing else");
  assert.equal(sunk[1].status, "dead");
});

test("over the cap the lowest score goes, and a used source outlives an unused one", () => {
  const many = Array.from({ length: MAX_PER_PLACE }, (_, i) => src(`s${i}.com`));
  let list = mergeSources([], many, { now: NOW });
  list = mergeSources(list, [], { used: ["https://s0.com"], dead: ["https://s1.com", "https://s1.com"], now: NOW });
  /* s0 is used; s1 has two misses and no uses: lowest score among the unused */
  list = mergeSources(list, [src("new.com")], { now: NOW });
  assert.equal(list.length, MAX_PER_PLACE);
  const names = list.map((s) => s.name);
  assert.ok(names.includes("s0.com") && names.includes("new.com"));
  assert.ok(!names.includes("s1.com"));
});

test("a used source is never evicted while an unused one exists", () => {
  const many = Array.from({ length: MAX_PER_PLACE }, (_, i) => src(`s${i}.com`));
  let list = mergeSources([], many, { now: NOW });
  /* everyone used except fresh-to-be; s5 has the worst score of the used */
  list = mergeSources(list, [], { used: many.map((s) => s.url), dead: ["https://s5.com", "https://s5.com"], now: NOW });
  list = mergeSources(list, [src("fresh.com")], { now: NOW });
  const names = list.map((s) => s.name);
  assert.ok(!names.includes("fresh.com"), "the unused newcomer goes before any used source");
  assert.ok(names.includes("s5.com"));
});

test("getSources and saveSources round-trip through the store", async () => {
  DOCS.clear();
  assert.equal(await getSources("boston-ma-usa"), null);
  assert.equal(await getSources("../etc"), null);
  const r = await saveSources({ name: "Boston", region: "MA", country: "USA" }, { sources: [src("a.com"), src("b.com")], now: NOW });
  assert.deepEqual(r, { slug: "boston-ma-usa", count: 2, added: 2, used: 0, dead: 0 });
  const r2 = await saveSources({ name: "Boston", region: "MA", country: "USA" },
    { sources: [src("c.com")], used: ["https://a.com"], dead: ["https://b.com", "https://zzz.com"], now: "2026-09-12T00:00:00Z" });
  assert.deepEqual(r2, { slug: "boston-ma-usa", count: 3, added: 1, used: 1, dead: 1 });
  const doc = DOCS.get("sources/boston-ma-usa");
  assert.deepEqual(doc.place, { name: "Boston", region: "MA", country: "USA" });
  assert.equal(doc.createdAt, NOW);
  assert.equal(doc.updatedAt, "2026-09-12T00:00:00Z");
  assert.equal(doc.sources[0].name, "a.com", "best first");
  await assert.rejects(saveSources({ name: "Montreal" }, {}));
});
