/* The board can ask for a fresh read of the owner's calendar. What matters
   is who may do what (only the owner starts a run, only the routine stores
   one), that a second tap does not start a second run, and that a read
   made for last weekend cannot land on this one. */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const url = (p) => new URL("../" + p, import.meta.url).href;
const docs = new Map();

mock.module(url("lib/auth.js"), {
  namedExports: {
    isAuthed: (req) => req.who === "owner",
    isRefreshJob: (req) => req.who === "job"
  }
});
mock.module(url("lib/store.js"), {
  namedExports: {
    getDoc: async (p) => (docs.has(p) ? structuredClone(docs.get(p)) : null),
    setDoc: async (p, d) => { docs.set(p, structuredClone(d)); return true; }
  }
});

const { default: handler, COOLDOWN_MS } = await import(url("api/calendar.js"));

const fired = [];
let fireStatus = 200;
globalThis.fetch = async (u, init) => {
  fired.push({ u, init });
  return { ok: fireStatus < 300, status: fireStatus,
    json: async () => ({ type: "routine_fire", claude_code_session_url: "https://claude.ai/code/s" }) };
};

function call(who, method, body) {
  const res = { code: 0, body: null,
    status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  return handler({ who, method, body }, res).then(() => res);
}

const WEEKEND = { id: "2026-09-26", days: [{ key: "sat", date: "2026-09-26" }, { key: "sun", date: "2026-09-27" }] };

beforeEach(() => {
  docs.clear(); fired.length = 0; fireStatus = 200;
  docs.set("board/current", { WEEKEND, EVENTS: [{ title: "Keep me" }], BUSY: [], busyAt: null });
  process.env.CALENDAR_ROUTINE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_x/fire";
  process.env.CALENDAR_ROUTINE_TOKEN = "tok";
});

test("nobody signed in gets nothing", async () => {
  assert.equal((await call(null, "GET")).code, 401);
});

test("the owner starts the routine, with the beta header and its own token", async () => {
  const res = await call("owner", "POST", { op: "refresh" });
  assert.equal(res.code, 202);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].u, process.env.CALENDAR_ROUTINE_URL);
  assert.equal(fired[0].init.headers.authorization, "Bearer tok");
  assert.equal(fired[0].init.headers["anthropic-beta"], "experimental-cc-routine-2026-04-01");
});

test("a second tap inside the cooldown does not start a second run", async () => {
  await call("owner", "POST", { op: "refresh" });
  const again = await call("owner", "POST", { op: "refresh" });
  assert.equal(again.code, 429);
  assert.equal(fired.length, 1);
  assert.ok(again.body.retryInMs > 0 && again.body.retryInMs <= COOLDOWN_MS);
});

test("a failed start frees the slot for another try", async () => {
  fireStatus = 500;
  assert.equal((await call("owner", "POST", { op: "refresh" })).code, 502);
  fireStatus = 200;
  assert.equal((await call("owner", "POST", { op: "refresh" })).code, 202);
});

test("without the routine configured, the board is told so and nothing is called", async () => {
  delete process.env.CALENDAR_ROUTINE_TOKEN;
  assert.equal((await call("owner", "POST", { op: "refresh" })).code, 501);
  assert.equal(fired.length, 0);
  assert.equal((await call("owner", "GET")).body.canRefresh, false);
});

test("the routine cannot start runs, and the owner cannot store a calendar", async () => {
  assert.equal((await call("job", "POST", { op: "refresh" })).code, 401);
  assert.equal((await call("owner", "POST", { op: "store", BUSY: [] })).code, 401);
});

test("the routine's read replaces BUSY and moves busyAt, and nothing else", async () => {
  const res = await call("job", "POST", { op: "store", weekendId: "2026-09-26",
    BUSY: [{ id: "t", title: "Trip", start: "2026-09-27", end: "2026-09-28" }] });
  assert.equal(res.code, 200);
  const doc = docs.get("board/current");
  assert.deepEqual(doc.BUSY.map((b) => [b.day, b.allDay]), [["sun", true]]);
  assert.ok(doc.busyAt);
  assert.deepEqual(doc.EVENTS, [{ title: "Keep me" }], "the listings are untouched");
  const got = await call("owner", "GET");
  assert.equal(got.body.busyAt, doc.busyAt);
  assert.equal(got.body.BUSY.length, 1);
});

test("a read made for another weekend is refused", async () => {
  const res = await call("job", "POST", { op: "store", weekendId: "2026-09-19", BUSY: [] });
  assert.equal(res.code, 409);
  assert.equal(docs.get("board/current").busyAt, null);
});

test("the routine's away stretches are stored with the calendar, cut per day", async () => {
  const res = await call("job", "POST", { op: "store", weekendId: "2026-09-26",
    BUSY: [{ id: "g", title: "Gig", timeZone: "America/Vancouver",
             start: "2026-09-26T20:10:00-07:00", end: "2026-09-26T20:30:00-07:00" }],
    AWAY: [{ start: "2026-09-25T07:30:00-04:00", end: "2026-09-28T09:00:00-04:00", where: "Revelstoke" }] });
  assert.equal(res.code, 200);
  const doc = docs.get("board/current");
  assert.deepEqual(doc.BUSY.map((b) => [b.day, b.from, b.zone]), [["sat", "20:10", "PDT"]]);
  assert.deepEqual(doc.AWAY.map((a) => [a.day, a.allDay, a.where]), [["sat", true, "Revelstoke"], ["sun", true, "Revelstoke"]]);
  assert.equal(res.body.away, 2);
});
