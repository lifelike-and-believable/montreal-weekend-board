/* The location layer exists because `hood` is one free-text field doing
   four jobs, and a colour derived from it is a claim about the city. Two
   things are load-bearing here: it must never alter `hood`, and it must
   never guess a line. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseHood, locate, locateAll, coverage } from "../lib/location.js";
import { findStation, stationKey, STATION_COUNT, LINES } from "../lib/metro.js";

test("reads neighbourhood and station out of one string", () => {
  assert.deepEqual(parseHood("Mile End · métro Laurier"), {
    area: "Mile End", areaKey: "mile-end",
    metro: "Laurier", metroKey: "laurier", lines: ["orange"], line: "orange"
  });
});

test("a leading street number is an address, not a district", () => {
  const l = parseHood("1450 rue Sainte-Catherine O · métro Guy-Concordia");
  assert.equal(l.addr, "1450 rue Sainte-Catherine O");
  assert.equal(l.area, undefined);
  assert.equal(l.line, "green");
});

test("the three spellings of Mile End collapse to one key", () => {
  const keys = ["Mile End · métro Laurier",
                "Mile End · 5240 av. du Parc",
                "Mile End · 5723 av. du Parc"].map((h) => parseHood(h).areaKey);
  assert.deepEqual(new Set(keys), new Set(["mile-end"]),
    "this is the whole point of the exercise");
});

test("an interchange gets its lines but never a single colour", () => {
  for (const [name, n] of [["Jean-Talon", 2], ["Berri-UQAM", 3], ["Lionel-Groulx", 2], ["Snowdon", 2]]) {
    const l = parseHood("métro " + name);
    assert.equal(l.lines.length, n, name + " line count");
    assert.equal(l.line, undefined, name + " must not be tinted one colour");
  }
});

test("an unknown station keeps its name and claims no colour", () => {
  const l = parseHood("métro Gare Centrale");
  assert.equal(l.metro, "Gare Centrale");
  assert.equal(l.lines, undefined);
  assert.equal(l.line, undefined);
});

test("a trailing qualifier does not hide the station", () => {
  assert.equal(parseHood("métro Montmorency then shuttle").metro, "Montmorency");
  assert.equal(parseHood("métro Montmorency then shuttle").line, "orange");
});

test("a venue note is dropped, not mistaken for a district", () => {
  assert.deepEqual(parseHood("Plateau · presented by Blue Skies Turn Black"),
    { area: "Plateau", areaKey: "plateau" });
  assert.equal(parseHood("Plateau · under La Sala Rossa").area, "Plateau");
});

test("accents, apostrophes and dashes all resolve", () => {
  assert.equal(parseHood("Côte-des-Neiges · métro Université-de-Montréal").line, "blue");
  assert.equal(parseHood("Old Montreal · métro Place-d'Armes").line, "orange");
  assert.equal(findStation("Guy–Concordia").line, "green", "en dash");
  assert.equal(findStation("De l'Église").line, "green");
});

test("Square-Victoria resolves through its alias", () => {
  assert.equal(parseHood("Old Montreal · métro Square-Victoria").metroKey,
    "square-victoria-oaci");
});

test("nothing readable yields null", () => {
  for (const h of ["", null, undefined, "   ", " · · "]) assert.equal(parseHood(h), null);
});

test("locate is additive: hood survives untouched", () => {
  const rec = Object.freeze({ title: "X", hood: "Mile End · métro Laurier", cat: "film" });
  const out = locate(rec);
  assert.equal(out.hood, rec.hood, "the board renders this verbatim");
  assert.equal(out.title, "X");
  assert.equal(out.cat, "film");
  assert.equal(out.loc.line, "orange");
});

test("a record with no hood, or already structured, is left alone", () => {
  const bare = { title: "Out of town", region: "Eastern Townships" };
  assert.equal(locate(bare), bare);
  const already = { hood: "Mile End", loc: { area: "Elsewhere" } };
  assert.equal(locate(already).loc.area, "Elsewhere", "upstream structure wins");
});

test("locateAll passes non-arrays straight through", () => {
  assert.equal(locateAll(undefined), undefined);
  assert.equal(locateAll(null), null);
  assert.deepEqual(locateAll([]), []);
});

test("coverage counts what was actually resolved", () => {
  const list = locateAll([
    { hood: "Mile End · métro Laurier" },   // area + metro + line
    { hood: "métro Jean-Talon" },                // metro, interchange, no line
    { hood: "Ahuntsic-Cartierville" },                // area only
    { region: "Eastern Townships" }                   // nothing
  ]);
  assert.deepEqual(coverage([list]), { total: 4, withArea: 2, withMetro: 2, withLine: 1 });
});

test("the station table is the real network, not a sketch", () => {
  assert.equal(STATION_COUNT, 68, "the Montreal metro has 68 stations");
  assert.deepEqual(LINES, ["green", "orange", "yellow", "blue"]);
  assert.equal(findStation("Angrignon").line, "green");        // green terminus
  assert.equal(findStation("Honore-Beaugrand").line, "green");  // other end
  assert.equal(findStation("Montmorency").line, "orange");      // orange terminus
  assert.equal(findStation("Saint-Michel").line, "blue");        // blue terminus
  assert.equal(findStation("Longueuil-Universite-de-Sherbrooke").line, "yellow");
});

test("every station in the shipped listings resolves", () => {
  /* If the refresh starts naming a station this table does not know, the
     colour silently disappears. Against the data we ship, it must not. */
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const hoods = [...html.matchAll(/hood:"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hoods.length > 50, "found the listings");
  const missed = [];
  for (const h of hoods) {
    const l = parseHood(h);
    if (l && l.metro && !l.lines) missed.push(l.metro);
  }
  assert.deepEqual(missed, [], "unmatched stations");
});

test("stationKey is stable across how people type a name", () => {
  const same = ["Guy-Concordia", "Guy–Concordia", "guy concordia", "GUY  CONCORDIA"];
  assert.equal(new Set(same.map(stationKey)).size, 1);
});
