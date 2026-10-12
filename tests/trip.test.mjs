/* The endpoints the routine calls: planning the week, and keeping a
   place's sources. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.REFRESH_SECRET = "test-secret";
process.env.AUTH_SECRET = "cookie-secret";

const url = (p) => new URL("../" + p, import.meta.url).href;
const DOCS = new Map();
const S = { getThrows: false };
mock.module(url("lib/store.js"), {
  namedExports: {
    getDoc: async (p) => { if (S.getThrows) throw new Error("redis down"); return DOCS.get(p) || null; },
    setDoc: async (p, d) => { DOCS.set(p, JSON.parse(JSON.stringify(d))); return true; },
    listDocs: async (c) => [...DOCS].filter(([k]) => k.startsWith(c + "/"))
      .map(([k, data]) => ({ id: k.slice(c.length + 1), data }))
  }
});

const { default: handler } = await import(url("api/trip.js"));
const { issueCookie } = await import(url("lib/auth.js"));

function call(method, { body, query, auth = "job" } = {}) {
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const headers = {};
  if (auth === "job") headers.authorization = "Bearer test-secret";
  if (auth === "owner") headers.cookie = issueCookie().split(";")[0];
  return handler({ method, headers, body, query: query || {} }, res).then(() => res);
}

const BOSTON = { name: "Boston", region: "MA", country: "USA" };
const away = [{ start: "2026-09-12", end: "2026-09-14", where: "Boston, MA, USA" }];

test("strangers are refused, and so are other methods", async () => {
  assert.equal((await call("GET", { auth: "none" })).code, 401);
  assert.equal((await call("POST", { auth: "none", body: { op: "plan", events: [] } })).code, 401);
  const r = await call("DELETE");
  assert.equal(r.code, 405);
});

test("plan returns the days, the place and that place's sources", async () => {
  DOCS.clear();
  await call("POST", { body: { op: "sources", place: BOSTON, sources: [
    { url: "https://a.com", name: "A", kind: "press" }, { url: "https://b.com", name: "B" }], used: [], dead: [] } });
  const r = await call("POST", { body: { op: "plan", today: "2026-09-09", away, events: [
    { title: "PTO", start: "2026-09-10", end: "2026-09-11" }] } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.days.map((d) => d.key), ["thu", "sat", "sun"]);
  assert.equal(r.body.place.slug, "boston-ma-usa");
  assert.equal(r.body.placeSource, "away");
  assert.deepEqual(r.body.sources.map((s) => s.url).sort(), ["https://a.com", "https://b.com"]);
});

test("the owner may plan too, today defaults, and home has no sources", async () => {
  const r = await call("POST", { auth: "owner", body: { op: "plan", events: [] } });
  assert.equal(r.code, 200);
  assert.match(r.body.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(r.body.sources, []);
  assert.equal(r.body.place, null);
});

test("a source-store failure does not cost the plan", async () => {
  S.getThrows = true;
  const r = await call("POST", { body: { op: "plan", today: "2026-09-09", away, events: [] } });
  S.getThrows = false;
  assert.equal(r.code, 200);
  assert.equal(r.body.place.name, "Boston");
  assert.deepEqual(r.body.sources, []);
});

test("plan validates its body", async () => {
  const bad = async (body, code) => {
    const r = await call("POST", { body });
    assert.equal(r.code, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(r.body.code, code);
  };
  await bad({ op: "plan" }, "bad_events");
  await bad({ op: "plan", events: Array(101).fill({}) }, "too_many_events");
  await bad({ op: "plan", events: [], away: "x" }, "bad_away");
  await bad({ op: "plan", events: [], today: "tomorrow" }, "bad_today");
  await bad({ op: "plan", events: [], today: "2026-02-31" }, "bad_today");
  await bad({ op: "nope" }, "bad_op");
});

test("sources is for the job only, and validates", async () => {
  const body = { op: "sources", place: BOSTON, sources: [] };
  assert.equal((await call("POST", { auth: "owner", body })).code, 401);
  assert.equal((await call("POST", { body: { ...body, place: { name: "Montreal" } } })).body.code, "bad_place");
  assert.equal((await call("POST", { body: { ...body, sources: "x" } })).body.code, "bad_sources");
  assert.equal((await call("POST", { body: { ...body, used: Array(101).fill("https://a.com") } })).body.code, "bad_used");
});

test("sources merges, counts, and is read back ranked", async () => {
  DOCS.clear();
  const r1 = await call("POST", { body: { op: "sources", place: BOSTON, sources: [{ url: "https://a.com" }, { url: "https://b.com" }] } });
  assert.deepEqual(r1.body, { ok: true, slug: "boston-ma-usa", count: 2, added: 2, used: 0, dead: 0 });
  const r2 = await call("POST", { body: { op: "sources", place: BOSTON, sources: [], used: ["https://b.com"], dead: ["https://a.com"] } });
  assert.equal(r2.body.used, 1);
  const get = await call("GET", { auth: "owner", query: { place: "boston-ma-usa" } });
  assert.equal(get.code, 200);
  assert.equal(get.body.place.name, "Boston");
  assert.deepEqual(get.body.sources.map((s) => s.url), ["https://b.com", "https://a.com"]);
  const none = await call("GET", { query: { place: "nowhere" } });
  assert.deepEqual(none.body.sources, []);
});

test("GET with no place lists the places that have a list", async () => {
  const r = await call("GET");
  assert.equal(r.code, 200);
  assert.equal(r.body.places.length, 1);
  assert.deepEqual([r.body.places[0].slug, r.body.places[0].name, r.body.places[0].count], ["boston-ma-usa", "Boston", 2]);
});
