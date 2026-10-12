/* The daily routine's token is for the daily routine. It may read the taste
   profile and read and write the captured posters, and nothing else in the
   store; the routes that spend money or touch photos take a signed-in
   browser only. A signed-in browser is unchanged. */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "auth-secret";
process.env.REFRESH_SECRET = "job-secret";

const url = (p) => new URL("../" + p, import.meta.url).href;
const docs = new Map();

mock.module(url("lib/store.js"), {
  namedExports: {
    cleanPath: (p) => String(p || "").replace(/^\/+|\/+$/g, "") || null,
    getDoc: async (p) => docs.get(p) ?? null,
    setDoc: async (p, d) => { docs.set(p, d); return true; },
    deleteDoc: async (p) => { docs.delete(p); return true; },
    listDocs: async (c) => [...docs].filter(([k]) => k.startsWith(c + "/"))
      .map(([k, data]) => ({ id: k.split("/").pop(), data }))
  }
});

const { default: handler } = await import(url("api/db.js"));
const { gate, issueCookie } = await import(url("lib/auth.js"));
const { jobMayUseDb } = await import(url("lib/scope.js"));

const job = { authorization: "Bearer job-secret" };
const owner = () => ({ cookie: issueCookie().split(";")[0] });

function call(body, headers) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(b) { resolve({ status: this.code, body: b }); }
    };
    handler({ method: "POST", headers, body }, res);
  });
}

beforeEach(() => {
  docs.clear();
  docs.set("taste/profile", { totalAdds: 3 });
  docs.set("plans/2026-09-12", { picks: ["x"] });
  docs.set("board/current", { WEEKEND: { id: "w" } });
  docs.set("spotted/a", { id: "a", title: "Poster" });
});

test("the job may read the taste profile", async () => {
  const r = await call({ op: "get", path: "taste/profile" }, job);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.totalAdds, 3);
});

test("the job may list, read and write captured posters", async () => {
  assert.equal((await call({ op: "list", path: "spotted" }, job)).status, 200);
  assert.equal((await call({ op: "get", path: "spotted/a" }, job)).status, 200);
  const set = await call({ op: "set", path: "spotted/a", data: { id: "a", title: "Poster", status: "verified" } }, job);
  assert.equal(set.status, 200);
  assert.equal(docs.get("spotted/a").status, "verified");
});

test("the job may not touch plans, the board, the taste profile's writes, or delete anything", async () => {
  const refused = [
    { op: "get", path: "plans/2026-09-12" },
    { op: "list", path: "plans" },
    { op: "set", path: "plans/2026-09-12", data: { picks: [] } },
    { op: "get", path: "board/current" },
    { op: "set", path: "board/current", data: { WEEKEND: null } },
    { op: "set", path: "taste/profile", data: { totalAdds: 0 } },
    { op: "delete", path: "taste/profile" },
    { op: "delete", path: "spotted/a" },
    { op: "list", path: "taste" },
    { op: "get", path: "spotted/../plans/2026-09-12" },
    { op: "get", path: "spotted/a/../../plans/2026-09-12" },
    { op: "set", path: "spotted", data: { x: 1 } },
    { op: "get", path: "" },
    { op: "bogus", path: "spotted/a" }
  ];
  for (const body of refused) {
    const r = await call(body, job);
    assert.equal(r.status, 401, JSON.stringify(body));
  }
  assert.deepEqual(docs.get("plans/2026-09-12"), { picks: ["x"] });
  assert.deepEqual(docs.get("board/current"), { WEEKEND: { id: "w" } });
  assert.deepEqual(docs.get("taste/profile"), { totalAdds: 3 });
  assert.ok(docs.has("spotted/a"));
});

test("a wrong or missing token gets nothing, including on allowed paths", async () => {
  for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: "Bearer " }]) {
    assert.equal((await call({ op: "get", path: "taste/profile" }, headers)).status, 401);
  }
});

test("a signed-in browser is not limited", async () => {
  assert.equal((await call({ op: "get", path: "plans/2026-09-12" }, owner())).status, 200);
  assert.equal((await call({ op: "set", path: "plans/2026-09-12", data: { picks: [] } }, owner())).status, 200);
  assert.equal((await call({ op: "delete", path: "plans/2026-09-12" }, owner())).status, 200);
});

test("the scope check itself", () => {
  assert.equal(jobMayUseDb({ op: "get", path: "taste/profile" }), true);
  assert.equal(jobMayUseDb({ op: "list", path: "spotted" }), true);
  assert.equal(jobMayUseDb({ op: "set", path: "spotted/abc-1.2" }), true);
  assert.equal(jobMayUseDb({ op: "set", path: "spotted/" }), false);
  assert.equal(jobMayUseDb({ op: "set", path: "spotted/a b" }), false);
  assert.equal(jobMayUseDb(null), false);
  assert.equal(jobMayUseDb({}), false);
  assert.equal(jobMayUseDb({ op: "get", path: 5 }), false);
});

test("routes without a job use take a signed-in browser only", () => {
  const res = () => ({ code: 0, status(c) { this.code = c; return this; }, json() { return this; } });
  const jobReq = { headers: job };
  const r1 = res();
  assert.equal(gate(jobReq, r1), false);
  assert.equal(r1.code, 401);
  assert.equal(gate({ headers: owner() }, res()), true);
});
