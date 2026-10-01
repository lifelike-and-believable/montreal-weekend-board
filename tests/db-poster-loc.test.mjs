/* Posters are saved through /api/db, never through the refresh, so the
   step that reads `hood` into `loc` has to happen on the way out of the
   db. Without it a poster's station gets no métro dot. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const url = (p) => new URL("../" + p, import.meta.url).href;
const docs = new Map();

mock.module(url("lib/auth.js"), { namedExports: { gate: () => true } });
mock.module(url("lib/store.js"), {
  namedExports: {
    cleanPath: (p) => p,
    getDoc: async (p) => docs.get(p) ?? null,
    setDoc: async (p, d) => { docs.set(p, d); return true; },
    deleteDoc: async (p) => { docs.delete(p); return true; },
    listDocs: async (c) => [...docs].filter(([k]) => k.startsWith(c + "/"))
      .map(([k, data]) => ({ id: k.split("/").pop(), data }))
  }
});

const { default: handler } = await import(url("api/db.js"));
const { relocate } = await import(url("lib/location.js"));

function call(body) {
  return new Promise((resolve) => {
    const res = { status() { return this; }, json: resolve };
    handler({ method: "POST", body }, res);
  });
}

test("listing posters adds loc read from hood", async () => {
  docs.clear();
  docs.set("spotted/a", { id: "a", title: "Art Book Fair", hood: "Mile End · métro Laurier" });
  docs.set("spotted/b", { id: "b", title: "No hood" });
  const { docs: out } = await call({ op: "list", path: "spotted" });
  const a = out.find((d) => d.id === "a").data;
  assert.deepEqual(a.loc.lines, ["orange"]);
  assert.equal(a.hood, "Mile End · métro Laurier");
  assert.equal("loc" in out.find((d) => d.id === "b").data, false);
});

test("a saved loc never outlives an edited hood", async () => {
  docs.clear();
  docs.set("spotted/a", { hood: "métro Pie-IX", loc: { metro: "Laurier", lines: ["orange"] } });
  const { data } = await call({ op: "get", path: "spotted/a" });
  assert.equal(data.loc.metro, "Pie-IX");
  assert.deepEqual(data.loc.lines, ["green"]);
});

test("other collections come back as stored", async () => {
  docs.clear();
  docs.set("plans/2026-10-03", { hood: "métro Laurier" });
  const { data } = await call({ op: "get", path: "plans/2026-10-03" });
  assert.deepEqual(data, { hood: "métro Laurier" });
  assert.deepEqual((await call({ op: "get", path: "spotted/missing" })).data, null);
});

test("relocate drops a stale loc when the hood no longer reads", () => {
  assert.deepEqual(relocate({ hood: "", loc: { metro: "Laurier" } }), { hood: "" });
});
