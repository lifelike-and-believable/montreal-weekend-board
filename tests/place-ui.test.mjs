/* Day-off days and travel mode, as the board page shows them. Lifted from
   index.html so what runs here is what ships. With no place, every one of
   these has to say exactly what the board said before places existed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build, html } from "./lift.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* a WEEKEND holder the lifted functions read through placeOf/placeLabel */
function withPlace(place) {
  const WEEKEND = place === undefined ? {} : { place };
  const placeOf = build("placeOf", { WEEKEND });
  const placeLabel = build("placeLabel", { placeOf });
  return { WEEKEND, placeOf, placeLabel };
}

test("placeLabel is empty at home and name + region away", () => {
  assert.equal(withPlace().placeLabel(), "");
  assert.equal(withPlace(null).placeLabel(), "");
  assert.equal(withPlace({ name: "  " }).placeLabel(), "");
  assert.equal(withPlace({ name: "Boston", region: "MA", slug: "boston" }).placeLabel(), "Boston, MA");
  assert.equal(withPlace({ name: "Paris", country: "France" }).placeLabel(), "Paris, France");
  assert.equal(withPlace({ name: "Boston", region: "MA", country: "US" }).placeLabel(), "Boston, MA");
  assert.equal(withPlace({ name: "Singapore", region: "Singapore" }).placeLabel(), "Singapore");
});

test("kicker, title and dateline follow the place", () => {
  const home = withPlace(), away = withPlace({ name: "Boston", region: "MA" });
  const k = (p) => build("kickerText", { placeLabel: p.placeLabel })();
  const t = (p) => build("titleText", { placeOf: p.placeOf })();
  const d = (p) => build("datelineText", { placeLabel: p.placeLabel })();
  assert.equal(k(home), "Anglophone-friendly · Montréal");
  assert.equal(k(away), "Travel mode · Boston, MA");
  assert.equal(t(home), "Montreal Weekend Board");
  assert.equal(t(away), "Weekend Board · Boston");
  assert.equal(d(home), "");
  assert.match(d(away), /Boston, MA/);
  assert.ok(html.includes('<p class="kicker" id="kicker">Anglophone-friendly · Montréal</p>'), "home markup untouched");
  assert.ok(html.includes("<title>Montreal Weekend Board</title>"));
});

test("the poster prompt names Montreal at home and the place away", () => {
  const prompt = (p) => build("posterPromptHead", { placeLabel: p.placeLabel })();
  const home = prompt(withPlace()), away = prompt(withPlace({ name: "Boston", region: "MA" }));
  assert.ok(home.startsWith("This is a photograph of a poster, flyer or handbill for an event in or near Montreal, Quebec. Read what"));
  assert.ok(away.startsWith("This is a photograph of a poster, flyer or handbill for an event in or near Boston, MA. Read what"));
  assert.ok(!away.includes("Montreal"));
  assert.equal(home.replace("Montreal, Quebec", "Boston, MA"), away, "only the place differs");
  assert.ok(home.endsWith('"unreadable":[string]}'));
});

test("the prompt is built after __BOARD_DATA__ has set WEEKEND", () => {
  const set = html.indexOf("WEEKEND  = BD.WEEKEND");
  const built = html.indexOf("var POSTER_PROMPT_HEAD = posterPromptHead()");
  assert.ok(set > 0 && built > set);
});

test("a day off gets a worded flag; a weekend day gets none", () => {
  const flag = build("dayOffFlagHtml");
  assert.equal(flag({ key: "fri", kind: "dayoff" }), '<span class="dayoff-flag">Day off</span>');
  assert.equal(flag({ key: "sat", kind: "weekend" }), "");
  assert.equal(flag({ key: "sat" }), "");
  assert.equal(flag(undefined), "");
  /* renderDays puts it beside Today, ahead of the busy flag */
  assert.match(html, /today-flag">Today<\/span>' : ''\) \+\s+dayOffFlagHtml\(d\) \+/);
});

test("footer sources: links only for http(s), everything escaped", () => {
  const safeHttpUrl = build("safeHttpUrl");
  const sourcesHtml = build("sourcesHtml", { sourceLinks: build("sourceLinks", { esc, safeHttpUrl }), esc });
  const out = sourcesHtml([
    { name: "Boston <b>Globe</b>", url: "https://www.bostonglobe.com/a?x=1&y=2", kind: "news" },
    { name: "evil", url: "javascript:alert(1)" },
    { name: "data", url: "data:text/html,<script>1</script>" },
    { name: "bare", url: "example.com" },
    { name: "", url: "http://plain.example/" },
    null
  ], 'Boston, "MA"');
  assert.ok(out.startsWith("<span>Sources for Boston, &quot;MA&quot;:</span> "));
  assert.ok(!out.includes("javascript:") && !out.includes("data:") && !out.includes("example.com\""));
  assert.ok(!out.includes("<b>") && !out.includes("<script"));
  assert.ok(out.includes("Boston &lt;b&gt;Globe&lt;/b&gt;"));
  assert.ok(out.includes('href="https://www.bostonglobe.com/a?x=1&amp;y=2"'));
  assert.ok(out.includes('href="http://plain.example/" target="_blank" rel="noopener">plain.example</a>'));
  assert.equal((out.match(/<a /g) || []).length, 2);
  assert.equal((out.match(/rel="noopener"/g) || []).length, 2);
});

test("footer sources: a quote in a URL cannot break out of the href", () => {
  const sourcesHtml = build("sourcesHtml", { sourceLinks: linksOf(), esc });
  const out = sourcesHtml([{ name: "q", url: 'https://ex.com/a"onmouseover="x' }], "Boston");
  assert.ok(!out.includes('"onmouseover'), out);
});

const linksOf = () => build("sourceLinks", { esc, safeHttpUrl: build("safeHttpUrl") });

test("footer sources: at most eight, and a quiet line when there are none", () => {
  const sourcesHtml = build("sourcesHtml", { sourceLinks: linksOf(), esc });
  const many = Array.from({ length: 12 }, (_, i) => ({ name: "S" + i, url: "https://s" + i + ".test/" }));
  assert.equal((sourcesHtml(many, "Boston").match(/<a /g) || []).length, 8);
  for (const none of [[], undefined, [{ name: "x", url: "javascript:1" }]]) {
    assert.equal(sourcesHtml(none, "Boston"), "<span>No listing sources picked for Boston yet.</span>");
  }
});

test("at home the footer takes the stored Montreal list, or keeps the links it shipped with", () => {
  const homeSourcesHtml = build("homeSourcesHtml", { sourceLinks: linksOf() });
  const out = homeSourcesHtml([{ name: "Cult MTL", url: "https://cultmtl.com/events" }, { name: "x", url: "javascript:1" }]);
  assert.equal(out, '<span>Sources:</span> <a href="https://cultmtl.com/events" target="_blank" rel="noopener">Cult MTL</a>');
  for (const none of [[], undefined, [{ name: "x", url: "javascript:1" }]]) assert.equal(homeSourcesHtml(none), "");
});

test("the footer keeps its hooks and the home links", () => {
  assert.ok(html.includes('id="taste-note"'));
  assert.ok(html.includes('id="foot-sources"') && html.includes('id="foot-film"'));
  assert.ok(html.includes("<span>Sources:</span>") && html.includes("https://cultmtl.com/"));
  assert.ok(html.includes("Film version codes follow Montreal house style"));
});

test("weather: the Montreal URL is exactly what it was; away uses the place's clock", () => {
  const weatherUrl = build("weatherUrl");
  assert.equal(weatherUrl(null, "2026-09-12", "2026-09-13"),
    "https://api.open-meteo.com/v1/forecast?latitude=45.5017&longitude=-73.5673" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&temperature_unit=fahrenheit&timezone=America%2FToronto&start_date=2026-09-12&end_date=2026-09-13");
  const away = weatherUrl({ lat: 42.36, lon: -71.06 }, "2026-09-09", "2026-09-13");
  assert.ok(away.includes("latitude=42.36&longitude=-71.06"));
  assert.ok(away.includes("timezone=auto") && !away.includes("Toronto"));
  assert.ok(away.endsWith("start_date=2026-09-09&end_date=2026-09-13"));
});

test("weather: geocode URL, coordinate checks, and the cache", async () => {
  const geocodeUrl = build("geocodeUrl");
  assert.equal(geocodeUrl("São Paulo"), "https://geocoding-api.open-meteo.com/v1/search?name=S%C3%A3o%20Paulo&count=1");
  const validCoords = build("validCoords");
  assert.deepEqual(validCoords("42.3", "-71"), { lat: 42.3, lon: -71 });
  assert.equal(validCoords(null, 5), null);
  assert.equal(validCoords("", ""), null);
  assert.equal(validCoords(91, 0), null);
  assert.equal(validCoords("x", 0), null);

  const store = {};
  const window = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } } };
  const calls = [];
  const mk = (place, fetchImpl) => {
    const w = withPlace(place);
    return build("placeCoords", { placeOf: w.placeOf, validCoords, geocodeUrl, window,
      fetch: (u) => { calls.push(u); return fetchImpl(u); } });
  };
  const ok = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [{ latitude: 42.36, longitude: -71.06 }] }) });

  assert.equal(await mk(undefined, ok)(), null, "home needs no look-up");
  assert.deepEqual(await mk({ name: "Boston", lat: 1, lon: 2 }, ok)(), { lat: 1, lon: 2 });
  assert.equal(calls.length, 0, "given coordinates are not looked up");

  const place = { name: "Boston", slug: "boston-ma" };
  assert.deepEqual(await mk(place, ok)(), { lat: 42.36, lon: -71.06 });
  assert.equal(calls.length, 1);
  assert.ok("mtl-weekend-geo-boston-ma" in store, "cached under a key with the slug");
  assert.deepEqual(await mk(place, ok)(), { lat: 42.36, lon: -71.06 });
  assert.equal(calls.length, 1, "second time comes from the cache");

  /* every failure is a quiet null */
  const fresh = { name: "Nowhere", slug: "nowhere" };
  assert.equal(await mk(fresh, () => Promise.reject(new Error("offline")))(), null);
  assert.equal(await mk(fresh, () => Promise.resolve({ ok: false }))(), null);
  assert.equal(await mk(fresh, () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))(), null);
  assert.equal(await mk(fresh, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [{ latitude: "x" }] }) }))(), null);
  assert.ok(!("mtl-weekend-geo-nowhere" in store), "failures are not cached");
});

test("weekendSpan lists the days the board really has", () => {
  const WEEKEND = { days: [{ date: "2026-09-09" }, { date: "2026-09-12" }, { date: "2026-09-13" }] };
  assert.deepEqual(build("weekendSpan", { WEEKEND })(),
    { from: "2026-09-09", to: "2026-09-13", dates: ["2026-09-09", "2026-09-12", "2026-09-13"] });
});

test("a run that falls wholly between two board days is not 'all weekend'", () => {
  /* Wed + Sat + Sun board; a Thu-Fri run touches none of them */
  const span = { from: "2026-09-09", to: "2026-09-13", dates: ["2026-09-09", "2026-09-12", "2026-09-13"] };
  const split = (rec) => build("splitSpotted", {
    spotted: [rec], onlineIndex: () => [], onlineTwin: () => null,
    weekendSpan: () => span,
    dayKeyForDate: (iso) => ({ "2026-09-09": "wed", "2026-09-12": "sat", "2026-09-13": "sun" })[iso] || null,
    spottedAsEvent: (r, dk) => ({ day: dk, recId: r.id }),
    spottedAsStanding: (r) => ({ recId: r.id })
  })();
  const rec = (a, b) => ({ id: "p", title: "T", startDate: a, endDate: b, status: "new" });
  const gap = split(rec("2026-09-10", "2026-09-11"));
  assert.deepEqual([gap.standing.length, gap.events.length, gap.coming.length], [0, 0, 0]);
  assert.equal(split(rec("2026-09-10", "2026-09-12")).standing.length, 1, "touches Saturday");
  assert.equal(split(rec("2026-09-09", "2026-09-09")).events.length, 1, "a day-off pick lands on its day");
  assert.equal(split(rec("2026-09-10", "2026-09-10")).coming.length, 1, "a single off-board day stays visible, not lost");
});

test("calendar links away carry the place's own clock", () => {
  const pad = build("pad");
  const localStamp = build("localStamp", { pad });
  assert.equal(localStamp("2026-09-12", "19:30", 0), "20260912T193000");
  assert.equal(localStamp("2026-09-12", "23:30", 90), "20260913T010000");
  const DAYMAP = { sat: { date: "2026-09-12" } };
  const mk = (place) => {
    const w = withPlace(place);
    return build("gcalUrl", { DAYMAP, placeOf: w.placeOf, localStamp,
      utcStamp: () => "UTC", WEEKEND: w.WEEKEND, plusDays: () => "x" });
  };
  const r = { day: "sat", time: "19:30", item: { title: "Show", dur: 60 } };
  assert.ok(mk({ name: "Boston", tz: "America/New_York" })(r).includes("dates=20260912T193000/20260912T203000&ctz=America%2FNew_York"));
  const home = mk(undefined)(r);
  assert.ok(home.includes("dates=UTC/UTC&location=") && !home.includes("ctz"));
});

test("the event that made a day off is not shown again as an occasion chip", () => {
  const isDayOffEvent = build("isDayOffEvent", {});
  const off = { kind: "dayoff", key: "mon", title: "PTO" };
  assert.equal(isDayOffEvent(off, { title: "Day Off" }), true, "the stock title, any case");
  assert.equal(isDayOffEvent(off, { title: "pto " }), true, "the title the plan recorded");
  assert.equal(isDayOffEvent(off, { title: "Sam's birthday" }), false, "a real occasion still shows");
  assert.equal(isDayOffEvent({ kind: "weekend", key: "sat" }, { title: "Day off" }), false, "only on a day off");
  assert.equal(isDayOffEvent(null, { title: "Day off" }), false);
  const chip = build("chipOccasion", { isDayOffEvent, occasionsOn: () => [{ title: "Day Off" }, { title: "Birthday" }] });
  assert.equal(chip(off).title, "Birthday");
  const only = build("chipOccasion", { isDayOffEvent, occasionsOn: () => [{ title: "Day Off" }] });
  assert.equal(only(off), null);
});
