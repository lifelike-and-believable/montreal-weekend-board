/* pruneBoard deletes documents and photographs, and nothing it deletes
   comes back. These are the rules that make that safe to run unattended.

   Run: npm test   (module mocking needs the flag in package.json)   */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
/* Resolved against this file, so the suite runs from any directory. */
const url = (p) => new URL("../" + p, import.meta.url).href;

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const START = iso(Date.now());          // the new weekend starts today

/* One registration, mutable state: re-mocking the same specifier throws. */
const S = { spotted: [], plans: [], blobs: [], spottedThrows: false,
            delThrows: false, deletedDocs: [], deletedBlobs: [] };

mock.module(url("lib/store.js"), {
  namedExports: {
    photoPrefix: () => "photos/SALT/",
    listDocs: async (c) => {
      if (c === "spotted") {
        if (S.spottedThrows) throw new Error("redis down");
        return S.spotted;
      }
      return c === "plans" ? S.plans : [];
    },
    deleteDoc: async (p) => { S.deletedDocs.push(p); return true; }
  }
});
mock.module("@vercel/blob", {
  namedExports: {
    list: async () => ({ blobs: S.blobs, hasMore: false, cursor: null }),
    del: async (u) => {
      if (S.delThrows) throw new Error("blob store refused");
      for (const x of [].concat(u)) S.deletedBlobs.push(x);
    }
  }
});

const { pruneBoard } = await import(url("lib/prune.js"));

async function run(over, opts = {}) {
  Object.assign(S, { spotted: [], plans: [], blobs: [], spottedThrows: false,
                     delThrows: false, deletedDocs: [], deletedBlobs: [] }, over);
  const report = await pruneBoard({ weekendStart: START, ...opts });
  return { docs: S.deletedDocs, blobs: S.deletedBlobs, report };
}

test("expired record and its photo are reclaimed", async () => {
  const r = await run({
    spotted: [{ id: "p1", data: { endDate: iso(Date.now() - 60 * DAY), photoId: "a.jpg" } }],
    blobs: [{ pathname: "photos/SALT/a.jpg", url: "https://blob/a.jpg", uploadedAt: ago(60) }]
  });
  assert.deepEqual(r.docs, ["spotted/p1"]);
  assert.deepEqual(r.blobs, ["https://blob/a.jpg"]);
  assert.equal(r.report.spotted, 1);
  assert.equal(r.report.photos, 1);
});

test("a record inside the 30-day grace window survives", async () => {
  const r = await run({
    spotted: [{ id: "p1", data: { endDate: iso(Date.now() - 5 * DAY), photoId: "a.jpg" } }],
    blobs: [{ pathname: "photos/SALT/a.jpg", url: "https://blob/a.jpg", uploadedAt: ago(5) }]
  });
  assert.deepEqual(r.docs, []);
  assert.deepEqual(r.blobs, []);
});

test("an undated poster awaiting a read is never touched", async () => {
  const r = await run({
    spotted: [{ id: "p1", data: { needsRead: true, photoId: "a.jpg" } }],
    blobs: [{ pathname: "photos/SALT/a.jpg", url: "https://blob/a.jpg", uploadedAt: ago(400) }]
  });
  assert.deepEqual(r.docs, []);
  assert.deepEqual(r.blobs, [], "still referenced by a live record");
});

test("a just-uploaded orphan photo is left alone (capture race)", async () => {
  const r = await run({
    blobs: [{ pathname: "photos/SALT/new.jpg", url: "https://blob/new.jpg", uploadedAt: ago(0) }]
  });
  assert.deepEqual(r.blobs, []);
});

test("an old orphan photo from a hand-deleted record is reclaimed", async () => {
  const r = await run({
    blobs: [{ pathname: "photos/SALT/old.jpg", url: "https://blob/old.jpg", uploadedAt: ago(90) }]
  });
  assert.deepEqual(r.blobs, ["https://blob/old.jpg"]);
});

test("plan documents expire on their own, longer clock", async () => {
  const r = await run({
    plans: [{ id: iso(Date.now() - 200 * DAY), data: {} },
            { id: iso(Date.now() - 30 * DAY), data: {} },
            { id: "not-a-date", data: {} }]
  });
  assert.equal(r.docs.length, 1, "only the 200-day-old plan goes");
  assert.equal(r.docs[0], "plans/" + iso(Date.now() - 200 * DAY));
});

test("dryRun counts without deleting", async () => {
  const r = await run({
    spotted: [{ id: "p1", data: { endDate: iso(Date.now() - 60 * DAY), photoId: "a.jpg" } }],
    blobs: [{ pathname: "photos/SALT/a.jpg", url: "https://blob/a.jpg", uploadedAt: ago(60) }],
    plans: [{ id: iso(Date.now() - 200 * DAY), data: {} }]
  }, { dryRun: true });
  assert.deepEqual(r.docs, []);
  assert.deepEqual(r.blobs, []);
  assert.deepEqual(
    { s: r.report.spotted, p: r.report.photos, pl: r.report.plans },
    { s: 1, p: 1, pl: 1 });
});

test("a missing weekend date refuses to delete anything", async () => {
  const r = await run({
    spotted: [{ id: "p1", data: { endDate: "2000-01-01", photoId: "a.jpg" } }],
    blobs: [{ pathname: "photos/SALT/a.jpg", url: "https://blob/a.jpg", uploadedAt: ago(900) }]
  }, { weekendStart: undefined });
  assert.deepEqual(r.docs, []);
  assert.deepEqual(r.blobs, []);
  assert.equal(r.report.errors.length, 1);
});

test("an unreadable record list never sweeps photos as orphans", async () => {
  const r = await run({
    spottedThrows: true,
    blobs: [{ pathname: "photos/SALT/a.jpg", url: "https://blob/a.jpg", uploadedAt: ago(900) }]
  });
  assert.deepEqual(r.blobs, [], "without records every photo looks orphaned");
  assert.ok(r.report.errors.some((e) => e.includes("spotted")));
});

test("pruneBoard never throws when the store is broken", async () => {
  const r = await run({ spottedThrows: true });
  assert.ok(r.report.errors.length >= 1);
});

test("a refused photo delete is reported, never counted as done", async () => {
  const r = await run({
    spotted: [{ id: "p1", data: { endDate: iso(Date.now() - 60 * DAY), photoId: "a.jpg" } }],
    blobs: [{ pathname: "photos/SALT/a.jpg", url: "https://blob/a.jpg", uploadedAt: ago(60) }],
    delThrows: true
  });
  assert.equal(r.report.photos, 0, "nothing was actually reclaimed");
  assert.ok(r.report.errors.some((e) => e.includes("photo")), "and it says so");
  assert.deepEqual(r.docs, ["spotted/p1"], "the record still goes");
});
