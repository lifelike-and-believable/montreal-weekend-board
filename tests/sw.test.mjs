/* The service worker decides what an installed home-screen app actually
   runs, and gets no second look in production. What matters here is the
   pair of promises it has to keep at once: a deployed shim must reach the
   device, and the board must still open with no network at all. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://board.test";

/** Boot sw.js against stubs and hand back its fetch handler. */
function boot({ cached = {}, net }) {
  const handlers = {};
  const store = { ...cached };
  const puts = [];

  const cache = {
    put: async (k, v) => { const key = typeof k === "string" ? k : k.url;
                           puts.push(key); store[key] = v; },
    addAll: async () => {}, match: async () => undefined
  };
  const caches = {
    open: async () => cache,
    match: async (k) => store[typeof k === "string" ? k : k.url],
    keys: async () => [], delete: async () => true
  };
  const self = { addEventListener: (n, f) => { handlers[n] = f; },
                 skipWaiting: async () => {}, clients: { claim: async () => {} } };

  new Function("self", "caches", "fetch", "location", SRC)(
    self, caches, net, { origin: ORIGIN });
  return { handlers, store, puts };
}

/** Drive one GET through the fetch handler. */
function get(handlers, path, mode = "no-cors") {
  const req = { method: "GET", url: ORIGIN + path, mode };
  let out, waited = [], dispatching = true, syncWaitUntil = true;
  handlers.fetch({ request: req,
                   respondWith: (p) => { out = p; },
                   waitUntil: (p) => {
                     if (!dispatching) syncWaitUntil = false;
                     waited.push(p);
                   } });
  dispatching = false;
  return { out, waited, req, syncWaitUntil };
}

const body = (t) => new Response(t, { status: 200 });
const never = () => new Promise(() => {});

test("a deployed shim reaches the device when the network answers", async () => {
  const { handlers, puts } = boot({
    cached: { [ORIGIN + "/claude-shim.js"]: body("old shim") },
    net: async () => body("new shim")
  });
  const { out, waited } = get(handlers, "/claude-shim.js");
  assert.equal(await (await out).text(), "new shim");
  await Promise.all(waited);
  assert.ok(puts.includes(ORIGIN + "/claude-shim.js"), "cache refreshed too");
});

test("the board still opens underground: a dead network yields the cache", async () => {
  const { handlers } = boot({
    cached: { [ORIGIN + "/claude-shim.js"]: body("old shim") },
    net: never
  });
  const started = Date.now();
  const { out } = get(handlers, "/claude-shim.js");
  assert.equal(await (await out).text(), "old shim");
  assert.ok(Date.now() - started < 4000, "must not wait out a dead connection");
});

test("a failing network yields the cache without waiting at all", async () => {
  const { handlers } = boot({
    cached: { [ORIGIN + "/gate.js"]: body("cached gate") },
    net: async () => { throw new Error("offline"); }
  });
  const started = Date.now();
  const { out } = get(handlers, "/gate.js");
  assert.equal(await (await out).text(), "cached gate");
  assert.ok(Date.now() - started < 500, "a refused connection is known at once");
});

test("nothing cached and no network gives a 503, not a hang", async () => {
  const { handlers } = boot({ cached: {}, net: async () => { throw new Error("offline"); } });
  const { out } = get(handlers, "/claude-shim.js");
  assert.equal((await out).status, 503);
});

test("/api is never touched by the worker", async () => {
  const { handlers } = boot({ cached: {}, net: async () => body("x") });
  const { out } = get(handlers, "/api/db");
  assert.equal(out, undefined, "respondWith must not be called for /api");
});

test("a navigation falls back to the cached shell", async () => {
  const { handlers } = boot({
    cached: { "/": body("shell") },
    net: async () => { throw new Error("offline"); }
  });
  const { out } = get(handlers, "/anything", "navigate");
  assert.equal(await (await out).text(), "shell");
});

test("an error page never becomes the offline shell", async () => {
  const { handlers, puts } = boot({
    cached: {}, net: async () => new Response("boom", { status: 500 })
  });
  const { out } = get(handlers, "/", "navigate");
  assert.equal((await out).status, 500, "the page still sees the error");
  assert.deepEqual(puts, [], "but it is not cached");
});

test("listings are raced the same way as the shim", async () => {
  const { handlers } = boot({
    cached: { [ORIGIN + "/board-data.js"]: body("last weekend") },
    net: async () => body("this weekend")
  });
  const { out } = get(handlers, "/board-data.js");
  assert.equal(await (await out).text(), "this weekend");
});

test("waitUntil is called while the event is still dispatching", async () => {
  /* Calling it from inside a .then() is an InvalidStateError on real
     implementations: by then the event has finished dispatching. */
  const { handlers } = boot({
    cached: { [ORIGIN + "/claude-shim.js"]: body("old shim") },
    net: async () => body("new shim")
  });
  const r = get(handlers, "/claude-shim.js");
  assert.equal(r.syncWaitUntil, true);
  assert.equal(r.waited.length, 1, "and it is actually called");
  await (await r.out).text();
});

test("the extension never rejects, so waitUntil cannot kill the worker", async () => {
  const { handlers } = boot({
    cached: { [ORIGIN + "/gate.js"]: body("cached gate") },
    net: async () => { throw new Error("offline"); }
  });
  const r = get(handlers, "/gate.js");
  await assert.doesNotReject(() => Promise.all(r.waited));
});
