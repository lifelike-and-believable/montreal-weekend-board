/* The ledger through /api/trip: recording a trip, keeping travel notes, and
   telling the routine whether this is a first visit. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.REFRESH_SECRET = "test-secret";
process.env.AUTH_SECRET = "cookie-secret";

const url = (p) => new URL("../" + p, import.meta.url).href;
const DOCS = new Map();
mock.module(url("lib/store.js"), {
  namedExports: {
    getDoc: async (p) => DOCS.get(p) || null,
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

const NYC = { name: "NYC" };

test("visit: a job records the trip and folds the owner's adds and stars for it into the place's notes", async () => {
  DOCS.set("taste/profile", { recent: [
    { title: "Hadestown", cat: "theatre", venue: "Walter Kerr", weekend: "2026-09-12", via: "add", at: "2026-09-10T00:00:00.000Z" },
    { title: "Home thing", cat: "film", venue: "x", weekend: "2026-09-19", via: "add", at: "2026-09-10T00:00:00.000Z" }] });
  const body = { op: "visit", place: NYC, weekendId: "2026-09-12", from: "2026-09-11", to: "2026-09-13" };
  assert.equal((await call("POST", { auth: "owner", body })).code, 401);
  const r = await call("POST", { body });
  assert.deepEqual(r.body, { ok: true, slug: "new-york-ny", visits: 1, personal: 1, noted: 1 });
  const again = await call("POST", { body });
  assert.deepEqual([again.body.visits, again.body.personal], [1, 1], "repeating a run adds nothing");
  assert.equal(DOCS.get("sources/new-york-ny").personal[0].title, "Hadestown");
  assert.equal((await call("POST", { body: { ...body, weekendId: "soon" } })).body.code, "bad_weekend");
  assert.equal((await call("POST", { body: { ...body, from: "x" } })).body.code, "bad_from");
  assert.equal((await call("POST", { body: { ...body, place: { name: "Montreal" } } })).body.code, "bad_place");
});

test("visit works without a taste profile", async () => {
  DOCS.delete("taste/profile");
  const r = await call("POST", { body: { op: "visit", place: NYC, weekendId: "2026-10-17" } });
  assert.equal(r.code, 200);
  assert.equal(r.body.visits, 2);
});

test("guide: a job adds travel notes; they are read back and survive a sources report", async () => {
  const body = { op: "guide", place: { name: "Brooklyn", region: "NY" },
    areas: [{ name: "Williamsburg", note: "venues, L train" }], transit: ["Subway, tap-to-pay OMNY"],
    stays: [], tips: ["Many venues are cash-light"] };
  assert.equal((await call("POST", { auth: "owner", body })).code, 401);
  const r = await call("POST", { body });
  assert.deepEqual(r.body, { ok: true, slug: "new-york-ny", guide: { areas: 1, transit: 1, stays: 0, tips: 1 } });
  await call("POST", { body: { op: "sources", place: NYC, sources: [{ url: "https://nyc.example.com" }] } });
  const get = await call("GET", { auth: "owner", query: { place: "new-york-ny" } });
  assert.equal(get.body.guide.areas[0].name, "Williamsburg");
  assert.equal(get.body.visits.length, 2, "a sources report keeps the visits");
  assert.equal(get.body.sources.length, 1);
  assert.equal((await call("POST", { body: { ...body, areas: "x" } })).body.code, "bad_areas");
  assert.equal((await call("POST", { body: { ...body, remove: [] } })).body.code, "bad_remove");
  const rm = await call("POST", { body: { op: "guide", place: NYC, remove: { tips: ["many venues are cash-light"] } } });
  assert.equal(rm.body.guide.tips, 0);
});

test("plan tells the routine whether this is a first visit and hands back the ledger", async () => {
  const trip = (where, today) => call("POST", { body: { op: "plan", today, events: [],
    away: [{ start: "2026-10-17", end: "2026-10-19", where }] } });
  const back = await trip("NYC", "2026-10-14");
  assert.equal(back.body.ledger.firstVisit, false, "the 12 Sep trip came before the 17 Oct weekend being planned");
  assert.equal(back.body.ledger.visits, 1, "the 17 Oct visit, already recorded, is not an earlier one");
  assert.equal(back.body.ledger.guide.areas[0].name, "Williamsburg");
  assert.equal(back.body.ledger.personal[0].title, "Hadestown");
  const first = await trip("Chicago", "2026-10-14");
  assert.equal(first.body.ledger.firstVisit, true);
  assert.equal(first.body.ledger.visits, 0);
  assert.equal((await call("POST", { body: { op: "plan", today: "2026-10-14", events: [] } })).body.ledger, null, "at home there is none");
});
