/* /board-data.js carries SOURCES for the place being visited, and a
   failure reading them never costs the page its listings. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.REFRESH_SECRET = "test-secret";
const url = (p) => new URL("../" + p, import.meta.url).href;
const S = { board: null, sources: null, sourcesThrow: false };
mock.module(url("lib/store.js"), {
  namedExports: {
    getDoc: async (p) => {
      if (p === "board/current") return S.board;
      if (S.sourcesThrow) throw new Error("redis down");
      return S.sources;
    },
    setDoc: async () => true
  }
});
const { default: handler } = await import(url("api/data.js"));

async function load() {
  let body = "";
  const res = { setHeader() {}, status() { return this; }, send(b) { body = b; return this; } };
  await handler({ headers: { authorization: "Bearer test-secret" } }, res);
  const window = {};
  new Function("window", body)(window);
  return window.__BOARD_DATA__;
}
const src = (i, extra) => ({ url: `https://s${i}.com`, name: "S" + i, kind: "press", covers: [], note: "", addedAt: "2026-01-01T00:00:00Z", lastUsedAt: null, uses: 0, misses: 0, ...extra });

test("at home SOURCES is an empty array", async () => {
  S.board = { WEEKEND: { id: "2026-09-12", days: [] } };
  assert.deepEqual((await load()).SOURCES, []);
});

test("away, SOURCES is the top eight live sources as name/url/kind", async () => {
  S.board = { WEEKEND: { id: "2026-09-12", days: [], place: { name: "Boston", slug: "boston" } } };
  S.sources = { sources: [...Array.from({ length: 10 }, (_, i) => src(i, { uses: i })), src(99, { uses: 0, misses: 4 })] };
  const out = (await load()).SOURCES;
  assert.equal(out.length, 8);
  assert.deepEqual(out[0], { name: "S9", url: "https://s9.com", kind: "press" });
  assert.ok(!out.some((s) => s.name === "S99"), "dead sources are not shown");
});

test("a failing source read leaves the page its listings", async () => {
  S.sourcesThrow = true;
  const data = await load();
  S.sourcesThrow = false;
  assert.deepEqual(data.SOURCES, []);
  assert.equal(data.WEEKEND.id, "2026-09-12");
});

test("away, /board-data.js carries the guide to the place, or null when there is none", async () => {
  S.board = { WEEKEND: { id: "2026-10-17", days: [], place: { name: "New York", slug: "new-york-ny" } } };
  S.sources = {
    visits: [{ weekendId: "2026-09-12", from: "2026-09-12", to: "2026-09-13" }],
    guide: { areas: [{ name: "Chelsea", note: "galleries", at: "2026-09-12T00:00:00Z" }] }
  };
  const g = (await load()).GUIDE;
  assert.equal(g.visits, 1);
  assert.deepEqual(g.guide.areas, [{ name: "Chelsea", note: "galleries" }]);
  S.sources = { sources: [] };
  assert.equal((await load()).GUIDE, null, "an empty ledger shows nothing");
  S.board = { WEEKEND: { id: "2026-10-17", days: [] } };
  assert.equal((await load()).GUIDE, null, "at home");
});
