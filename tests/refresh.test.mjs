/* The refresh is the only writer of the listings, so what it stores is
   what every reader sees. These cover the wiring rather than the parsing:
   that `loc` actually lands in the stored document, that `hood` comes
   through untouched, and that a broken location layer can never cost a
   run its listings. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.REFRESH_SECRET = "test-secret";

const url = (p) => new URL("../" + p, import.meta.url).href;
const S = { stored: null, prev: null, setThrows: false, locateThrows: false };

/* Delegate to the real location layer, with a switch to break it. */
const realLocation = await import(url("lib/location.js"));
mock.module(url("lib/location.js"), {
  namedExports: {
    locateAll: (list) => {
      if (S.locateThrows) throw new Error("location layer exploded");
      return realLocation.locateAll(list);
    },
    coverage: (lists) => realLocation.coverage(lists)
  }
});

mock.module(url("lib/store.js"), {
  namedExports: {
    getDoc: async () => S.prev,
    setDoc: async (path, data) => {
      if (S.setThrows) throw new Error("redis down");
      S.stored = { path, data };
      return true;
    }
  }
});
mock.module(url("lib/prune.js"), {
  namedExports: { pruneBoard: async () => ({ spotted: 0, photos: 0, plans: 0, errors: [] }) }
});

const { default: handler } = await import(url("api/refresh.js"));

function post(body) {
  S.stored = null;
  const res = {
    code: 0, body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; }
  };
  const req = {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body
  };
  return handler(req, res).then(() => res);
}

const WEEKEND = { id: "2026-09-12", days: [{ key: "sat", date: "2026-09-12" }] };
const payload = () => ({
  WEEKEND,
  STANDING: [{ id: "a", title: "Thing", hood: "Mile End · métro Laurier" }],
  EVENTS: [{ title: "Film", hood: "Little Italy · métro Jean-Talon" },
           { title: "Talk", hood: "Ahuntsic-Cartierville" }],
  AFIELD: [{ title: "Trip", region: "Eastern Townships" }]
});

test("the stored listings carry structured locations", async () => {
  const res = await post(payload());
  assert.equal(res.code, 200);
  assert.equal(S.stored.path, "board/current");
  const standing = S.stored.data.STANDING[0];
  assert.equal(standing.loc.areaKey, "mile-end");
  assert.equal(standing.loc.line, "orange");
});

test("hood reaches the store exactly as it arrived", async () => {
  await post(payload());
  assert.equal(S.stored.data.STANDING[0].hood, "Mile End · métro Laurier",
    "the board renders this string verbatim");
  assert.equal(S.stored.data.EVENTS[1].hood, "Ahuntsic-Cartierville");
});

test("an interchange is stored without a colour", async () => {
  await post(payload());
  const ev = S.stored.data.EVENTS[0];
  assert.deepEqual(ev.loc.lines, ["orange", "blue"]);
  assert.equal(ev.loc.line, undefined);
});

test("a record with nothing to locate is stored as it came", async () => {
  await post(payload());
  assert.deepEqual(S.stored.data.AFIELD[0], { title: "Trip", region: "Eastern Townships" });
});

test("the run reports its coverage", async () => {
  const res = await post(payload());
  assert.deepEqual(res.body.located, { total: 4, withArea: 3, withMetro: 2, withLine: 1 });
  assert.deepEqual(res.body.counts, { standing: 1, events: 2, afield: 1, busy: 0 });
});

test("an empty run is still refused, structure or not", async () => {
  const res = await post({ WEEKEND, STANDING: [], EVENTS: [], AFIELD: [] });
  assert.equal(res.code, 400);
  assert.equal(res.body.code, "empty_payload");
  assert.equal(S.stored, null, "the board is not blanked");
});

test("a store failure is still a failed run", async () => {
  S.setThrows = true;
  const res = await post(payload());
  S.setThrows = false;
  assert.equal(res.code, 500);
  assert.equal(res.body.code, "store_error");
});

test("the wrong token stores nothing", async () => {
  const res = { code: 0, body: null,
                status(c){ this.code = c; return this; }, json(b){ this.body = b; return this; } };
  S.stored = null;
  await handler({ method: "POST", headers: { authorization: "Bearer wrong" }, body: payload() }, res);
  assert.equal(res.code, 401);
  assert.equal(S.stored, null);
});

test("a broken location layer costs structure, never the listings", async () => {
  S.locateThrows = true;
  const res = await post(payload());
  S.locateThrows = false;

  assert.equal(res.code, 200, "the run still succeeds");
  assert.equal(S.stored.path, "board/current");
  assert.equal(S.stored.data.STANDING[0].hood, "Mile End · métro Laurier");
  assert.equal(S.stored.data.STANDING[0].loc, undefined, "no structure, but the listing is there");
  assert.equal(S.stored.data.EVENTS.length, 2);
  assert.equal(res.body.located, null, "and it does not claim coverage it did not get");
});

/* BUSY: the owner's calendar for the same days. A run that could not read
   the calendar sends none, and must not make the weekend look free. */
const BUSY_WEEKEND = { id: "2026-09-26", days: [{ key: "sat", date: "2026-09-26" }, { key: "sun", date: "2026-09-27" }] };
const withBusy = (busy) => {
  const b = { ...payload(), WEEKEND: BUSY_WEEKEND };
  if (busy !== undefined) b.BUSY = busy;
  return b;
};

test("calendar events are stored cut to the weekend's days", async () => {
  S.prev = null;
  const res = await post(withBusy([
    { id: "trip", title: "Trip to Quebec City", start: "2026-09-26", end: "2026-09-28" }
  ]));
  assert.equal(res.code, 200);
  assert.equal(res.body.counts.busy, 2);
  assert.deepEqual(S.stored.data.BUSY.map((b) => [b.day, b.allDay]), [["sat", true], ["sun", true]]);
});

test("a run with no BUSY keeps what the last run found for the same weekend", async () => {
  const kept = [{ id: "x~sat", day: "sat", from: "10:00", to: "12:00", allDay: false, title: "Dentist", where: "" }];
  S.prev = { WEEKEND: BUSY_WEEKEND, BUSY: kept };
  await post(withBusy(undefined));
  assert.deepEqual(S.stored.data.BUSY, kept);
  S.prev = null;
});

test("a run with no BUSY does not carry last weekend's calendar into a new one", async () => {
  S.prev = { WEEKEND: { id: "2026-09-19", days: [] }, BUSY: [{ id: "old~sat", day: "sat" }] };
  await post(withBusy(undefined));
  assert.deepEqual(S.stored.data.BUSY, []);
  S.prev = null;
});

test("an empty BUSY is an answer, and clears the weekend", async () => {
  S.prev = { WEEKEND: BUSY_WEEKEND, BUSY: [{ id: "x~sat", day: "sat" }] };
  await post(withBusy([]));
  assert.deepEqual(S.stored.data.BUSY, []);
  S.prev = null;
});
