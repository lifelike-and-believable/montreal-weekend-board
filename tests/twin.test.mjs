/* Photograph a poster on Tuesday and the morning refresh may well find
   the organisers' own listing for the same night by Saturday. Two cards
   for one evening is worse than either, so the refreshed listing takes
   the slot and the poster record steps aside behind it.

   What is worth pinning down is where the line falls: a twin claimed too
   eagerly loses an event off the board entirely, and one missed shows the
   same night twice. Lifted from index.html so what runs here is what
   ships. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "./lift.mjs";

const titleKey = build("titleKey");
const keysMatch = build("keysMatch");
const onlineListings = build("onlineListings", { titleKey });
const onlineTwin = build("onlineTwin", { titleKey, keysMatch });

const WEEKEND = { days: [{ key: "sat", date: "2026-09-12" }, { key: "sun", date: "2026-09-13" }] };
const DAYMAP = { sat: WEEKEND.days[0], sun: WEEKEND.days[1] };

/* splitSpotted reads the board around it; hand it the names it uses.
   spottedAsEvent / spottedAsStanding are stood in for — which bucket a
   record lands in is the question here, not how its card reads. */
function splitWith(spotted, { standing = [], events = [] } = {}) {
  const rows = onlineListings(standing, events, DAYMAP);
  const deps = {
    spotted,
    onlineTwin,
    onlineIndex: () => rows,
    weekendSpan: () => ({ from: WEEKEND.days[0].date, to: WEEKEND.days[1].date }),
    dayKeyForDate: (iso) => (WEEKEND.days.filter((d) => d.date === iso)[0] || {}).key || null,
    spottedAsEvent: (rec, dayKey) => ({ from: "spotted", day: dayKey, title: rec.title, recId: rec.id }),
    spottedAsStanding: (rec) => ({ from: "spotted", title: rec.title, recId: rec.id })
  };
  return build("splitSpotted", deps)();
}

const poster = (o) => Object.assign({
  id: "p1", title: "Kim Gordon", cat: "music",
  startDate: "2026-09-12", endDate: "2026-09-12", status: "new"
}, o);

const listed = (o) => Object.assign({ day: "sat", cat: "music", title: "Kim Gordon",
                                      times: ["20:00"], url: "https://evenko.ca/kim-gordon" }, o);

test("a title survives case, accents and punctuation", () => {
  assert.equal(titleKey("Théâtre Rialto: Bal Masqué!"), "theatre rialto bal masque");
  assert.equal(titleKey("JACKALOPE"), titleKey("Jackalope"));
  assert.equal(titleKey(null), "");
});

test("a whole word at the front counts; a word inside does not", () => {
  const k = (a, b) => keysMatch(titleKey(a), titleKey(b));
  assert.ok(k("JACKALOPE", "Jackalope Fest 2026"));
  assert.ok(k("Piknic Électronik", "piknic electronik"));
  assert.ok(!k("Tony", "Tony Hawk Demo"), "a four-letter title stands on its own");
  assert.ok(!k("SUNSAT", "SUNSET"), "one letter apart is not the same night out");
  assert.ok(!k("Gordon", "Kim Gordon"), "matching the end of a title is not matching it");
  assert.ok(!k("", "Kim Gordon"));
});

test("the refreshed listing takes the slot and keeps the poster's Edit button", () => {
  const ev = listed();
  const out = splitWith([poster()], { events: [ev] });
  assert.equal(out.events.length, 0, "the poster card is gone");
  assert.equal(out.standing.length, 0);
  assert.equal(out.coming.length, 0);
  assert.equal(out.merged, 1);
  assert.equal(ev.recId, "p1", "Edit still reaches the poster, its photo and its record");
  assert.equal(ev.fromPoster, true);
  assert.equal(ev.url, "https://evenko.ca/kim-gordon", "the listing keeps its own details");
  assert.equal(ev.times[0], "20:00");
});

test("a poster the refresh has not found keeps its own card", () => {
  const out = splitWith([poster()], { events: [listed({ title: "Someone Else" })] });
  assert.equal(out.merged, 0);
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].from, "spotted");
});

test("the same title on another night is another event", () => {
  const sun = listed({ day: "sun" });
  const out = splitWith([poster()], { events: [sun] });
  assert.equal(out.merged, 0, "Saturday's poster is not Sunday's listing");
  assert.equal(out.events.length, 1);
  assert.equal(sun.recId, null);
});

test("a run on the poster is answered by a run in the listings", () => {
  const run = { id: "jackalope", cat: "fest", title: "JACKALOPE", when: "Fri 11 – Sun 13 Sep" };
  const out = splitWith([poster({ id: "p2", title: "Jackalope Fest", startDate: "2026-09-12",
                                  endDate: "2026-09-13" })], { standing: [run] });
  assert.equal(out.merged, 1);
  assert.equal(out.standing.length, 0);
  assert.equal(run.recId, "p2");
});

test("a dated listing is preferred to a standing one", () => {
  /* Both are the same festival; the dated row is the more exact claim,
     and it is the one the poster's night belongs to. */
  const run = { id: "fqd", cat: "dance", title: "Festival Quartiers Danses" };
  const night = listed({ cat: "dance", title: "Festival Quartiers Danses" });
  const out = splitWith([poster({ id: "p3", title: "Festival Quartiers Danses", cat: "dance" })],
                        { standing: [run], events: [night] });
  assert.equal(out.merged, 1);
  assert.equal(night.recId, "p3");
  assert.equal(run.recId, null);
});

test("next year's poster is not this weekend's festival", () => {
  /* The record is months away, so it belongs in Coming up whatever the
     listings say — the edition running now is a different weekend. */
  const run = { id: "jackalope", cat: "fest", title: "JACKALOPE" };
  const rec = poster({ id: "p4", title: "JACKALOPE", startDate: "2027-09-11", endDate: "2027-09-12" });
  const out = splitWith([rec], { standing: [run] });
  assert.equal(out.merged, 0);
  assert.deepEqual(out.coming, [rec]);
  assert.equal(run.recId, null);
});

test("a poster still waiting to be filled in is never merged away", () => {
  const ev = listed();
  const out = splitWith([poster({ needsRead: true }), poster({ id: "p5", status: "rejected" })],
                        { events: [ev] });
  assert.equal(out.merged, 0);
  assert.equal(ev.recId, null, "the pen keeps them; the listing says nothing about them");
});

test("the hand-over is worked out fresh each render", () => {
  /* The listings are the same objects every render. A record deleted
     between two renders must not leave an Edit button pointing at it. */
  const ev = listed();
  const rows = onlineListings([], [ev], DAYMAP);
  const run = (spotted) => build("splitSpotted", {
    spotted, onlineTwin, onlineIndex: () => rows,
    weekendSpan: () => ({ from: "2026-09-12", to: "2026-09-13" }),
    dayKeyForDate: () => "sat",
    spottedAsEvent: (rec, dk) => ({ day: dk, recId: rec.id }),
    spottedAsStanding: (rec) => ({ recId: rec.id })
  })();

  run([poster()]);
  assert.equal(ev.recId, "p1");
  const out = run([]);
  assert.equal(ev.recId, null, "the poster is gone, so the hand-over is too");
  assert.equal(ev.fromPoster, false);
  assert.equal(out.merged, 0);
});

test("an event that was over before the weekend is still dropped", () => {
  const out = splitWith([poster({ startDate: "2026-08-01", endDate: "2026-08-01" })]);
  assert.equal(out.events.length + out.standing.length + out.coming.length, 0);
});
