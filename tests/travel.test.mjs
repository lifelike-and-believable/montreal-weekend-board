/* Before this, the itinerary told you every short gap was "to get across
   town" whether or not the two things were on the same street. These
   cover the two rules that matter: the wording must follow what the data
   actually says about where, and nothing may invent a distance or a
   journey time, because nothing here knows one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseHood } from "../lib/location.js";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function lift(name) {
  const decl = "function " + name + "(";
  const i = html.indexOf(decl);
  assert.notEqual(i, -1, name + " not found in index.html");
  const argEnd = html.indexOf(")", i + decl.length);
  const args = html.slice(i + decl.length, argEnd);
  const bodyStart = html.indexOf("{", argEnd) + 1;
  let depth = 1, j = bodyStart;
  while (j < html.length && depth > 0) {
    const c = html[j++];
    if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  assert.equal(depth, 0, name + " braces did not balance");
  return { args, body: html.slice(bodyStart, j - 1) };
}
const mk = (name, ...deps) => {
  const f = lift(name);
  return new Function(...deps.map((d) => d[0]),
    "return function (" + f.args + ") {" + f.body + "}")(...deps.map((d) => d[1]));
};
const escF = lift("esc");
const esc = new Function(escF.args, escF.body);
const fmtGapF = lift("fmtGap");
const fmtGap = new Function(fmtGapF.args, fmtGapF.body);
const travelRel = mk("travelRel");
const gapHtml = mk("gapHtml", ["esc", esc], ["fmtGap", fmtGap]);

/* Build items the way the refresh would. */
const at = (hood) => ({ loc: parseHood(hood) });
const MILE_END = at("Mile End · métro Laurier");
const MILE_END_2 = at("Mile End · 5240 av. du Parc");
const PLATEAU = at("Plateau · métro Mont-Royal");     // orange, like Laurier
const NDG = at("Côte-des-Neiges · métro Université-de-Montréal"); // blue
const ISLAND = at("Île Notre-Dame · métro Jean-Drapeau");  // yellow
const NOWHERE = { title: "Out of town" };

test("the same neighbourhood is recognised across spellings", () => {
  const rel = travelRel(MILE_END, MILE_END_2);
  assert.equal(rel.kind, "same");
  assert.equal(rel.where, "both in Mile End");
});

test("two stations on one line are a direct ride", () => {
  const rel = travelRel(MILE_END, PLATEAU);
  assert.equal(rel.kind, "line");
  assert.equal(rel.where, "direct on the orange line");
});

test("no shared line is far, and says nothing more", () => {
  const rel = travelRel(ISLAND, NDG);
  assert.equal(rel.kind, "far");
  assert.equal(rel.where, null);
});

test("an unplaced pick yields no relation at all", () => {
  assert.equal(travelRel(MILE_END, NOWHERE), null);
  assert.equal(travelRel(NOWHERE, MILE_END), null);
  assert.equal(travelRel(NOWHERE, NOWHERE), null);
});

test("a short gap in one neighbourhood is no longer a warning", () => {
  const out = gapHtml(20, travelRel(MILE_END, MILE_END_2));
  assert.ok(!out.includes("clash"), "walking down the street is not tight");
  assert.ok(!out.includes("across town"), "and it is certainly not across town");
  assert.match(out, /20 min — both in Mile End/);
});

test("a short gap across town still warns", () => {
  const out = gapHtml(20, travelRel(ISLAND, NDG));
  assert.match(out, /class="gap clash"/);
  assert.match(out, /20 min to get across town — tight/);
});

test("a short gap on one line warns, but says it is direct", () => {
  const out = gapHtml(20, travelRel(MILE_END, PLATEAU));
  assert.match(out, /class="gap clash"/);
  assert.match(out, /direct on the orange line, tight/);
});

test("a short gap between unplaced picks claims nothing about distance", () => {
  const out = gapHtml(20, null);
  assert.match(out, /20 min between them — tight/);
  assert.ok(!out.includes("across town"), "it does not know that");
});

test("back to back is always a warning, but says where when it can", () => {
  assert.match(gapHtml(0, travelRel(MILE_END, MILE_END_2)),
    /back to back — both in Mile End, but no gap at all/);
  assert.match(gapHtml(0, null), /back to back — no travel time at all/);
  assert.match(gapHtml(0, null), /clash/);
});

test("a comfortable gap stays calm and adds where only when useful", () => {
  assert.match(gapHtml(90, travelRel(MILE_END, PLATEAU)),
    /free · direct on the orange line/);
  assert.match(gapHtml(90, travelRel(MILE_END, MILE_END_2)), /free · both in Mile End/);
  const far = gapHtml(90, travelRel(ISLAND, NDG));
  assert.match(far, /free/);
  assert.ok(!far.includes("·"), "nothing to add when they are simply far apart");
  assert.ok(!far.includes("clash"));
});

test("no wording anywhere invents a journey time", () => {
  /* Every minute figure shown must be the gap itself. */
  for (const rel of [travelRel(MILE_END, MILE_END_2), travelRel(MILE_END, PLATEAU),
                     travelRel(ISLAND, NDG), null]) {
    for (const g of [0, 5, 20, 45, 200]) {
      const nums = (gapHtml(g, rel).match(/\d+/g) || []).map(Number);
      for (const n of nums) {
        assert.ok(n === g || n === Math.floor(g / 60) || n === g % 60,
          "unexpected number " + n + " for a gap of " + g);
      }
    }
  }
});

test("a neighbourhood name cannot inject markup", () => {
  const evil = { loc: { areaKey: "x", area: '<img src=x onerror=alert(1)>' } };
  const out = gapHtml(20, travelRel(evil, { loc: { areaKey: "x", area: "y" } }));
  assert.ok(!out.includes("<img"));
  assert.match(out, /&lt;img/);
});
