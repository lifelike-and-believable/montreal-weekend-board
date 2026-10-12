/* The calendar routine has a token of its own. With CALENDAR_SECRET set, only
   it may read or store the calendar, and the daily routine's token may not.
   Until it is set, the daily token still works, so a deploy does not break
   "check again" before the routine has the new value. */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "auth-secret";
process.env.REFRESH_SECRET = "refresh-secret";

const url = (p) => new URL("../" + p, import.meta.url).href;
const docs = new Map();

mock.module(url("lib/store.js"), {
  namedExports: {
    getDoc: async (p) => docs.get(p) ?? null,
    setDoc: async (p, d) => { docs.set(p, d); return true; }
  }
});

const { default: handler } = await import(url("api/calendar.js"));
const { default: health } = await import(url("api/health.js"));
const { issueCookie } = await import(url("lib/auth.js"));

const bearer = (t) => ({ authorization: `Bearer ${t}` });

function call(method, body, headers) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(b) { resolve({ status: this.code, body: b }); }
    };
    handler({ method, headers, body }, res);
  });
}

const store = { op: "store", BUSY: [] };

beforeEach(() => {
  docs.clear();
  docs.set("board/current", {
    WEEKEND: { id: "2026-09-12", days: [{ key: "sat", date: "2026-09-12" }, { key: "sun", date: "2026-09-13" }] },
    EVENTS: ["kept"]
  });
  delete process.env.CALENDAR_SECRET;
});

test("with CALENDAR_SECRET set, it can read and store, and the daily token cannot", async () => {
  process.env.CALENDAR_SECRET = "calendar-secret";
  assert.equal((await call("GET", undefined, bearer("calendar-secret"))).status, 200);
  assert.equal((await call("POST", store, bearer("calendar-secret"))).status, 200);
  assert.equal((await call("GET", undefined, bearer("refresh-secret"))).status, 401);
  assert.equal((await call("POST", store, bearer("refresh-secret"))).status, 401);
});

test("storing the calendar leaves the listings alone", async () => {
  process.env.CALENDAR_SECRET = "calendar-secret";
  await call("POST", { ...store, BUSY: [] }, bearer("calendar-secret"));
  assert.deepEqual(docs.get("board/current").EVENTS, ["kept"]);
});

test("until CALENDAR_SECRET is set, the daily token still works", async () => {
  assert.equal((await call("POST", store, bearer("refresh-secret"))).status, 200);
});

test("a wrong token, or none, is refused either way", async () => {
  for (const set of [false, true]) {
    if (set) process.env.CALENDAR_SECRET = "calendar-secret";
    assert.equal((await call("POST", store, bearer("nope"))).status, 401);
    assert.equal((await call("POST", store, {})).status, 401);
  }
});

test("the calendar token does not start a refresh, which is the owner's", async () => {
  process.env.CALENDAR_SECRET = "calendar-secret";
  const r = await call("POST", { op: "refresh" }, bearer("calendar-secret"));
  assert.equal(r.status, 401);
});

test("a signed-in browser can still read", async () => {
  process.env.CALENDAR_SECRET = "calendar-secret";
  const owner = { cookie: issueCookie().split(";")[0] };
  assert.equal((await call("GET", undefined, owner)).status, 200);
});

test("health says whether the calendar has its own token, never the value", () => {
  const read = () => {
    let out;
    health({ headers: {} }, { status() { return this; }, json(b) { out = b; } });
    return out;
  };
  assert.equal(read().config.CALENDAR_SECRET, false);
  process.env.CALENDAR_SECRET = "do-not-leak";
  const body = read();
  assert.equal(body.config.CALENDAR_SECRET, true);
  assert.equal(JSON.stringify(body).includes("do-not-leak"), false);
});
