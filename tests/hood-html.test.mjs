/* hoodHtml is the one amendment made to the board's own script. It splits
   an escaped string into three pieces to tint the middle one, so the thing
   most worth pinning down is that every piece still gets escaped — and
   that every path without a confident single line renders the text
   exactly as the board did before. Lifted from index.html so what runs
   here is what ships. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

/* Pull a function out of the board by walking its braces. No regex, so
   nothing here depends on escaping surviving a shell. Safe for these two
   because neither body contains a brace inside a string literal. */
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
const escFn = lift("esc");          // the board's own, the first in the file
const hoodFn = lift("hoodHtml");
const esc = new Function(escFn.args, escFn.body);
const hoodHtml = new Function("esc",
  "return function (" + hoodFn.args + ") {" + hoodFn.body + "}")(esc);

const LAURIER = "Mile End · métro Laurier";

const dotsIn = (html) => (html.match(/class="mdot is-(green|orange|yellow|blue)"/g) || [])
  .map((m) => m.slice('class="mdot is-'.length, -1));

test("a single-line station gets one dot in its colour", () => {
  const out = hoodHtml({ hood: LAURIER, loc: { metro: "Laurier", lines: ["orange"] } });
  assert.deepEqual(dotsIn(out), ["orange"]);
  assert.match(out, /métro Laurier<\/span>/);
  assert.ok(out.startsWith("Mile End · "), "the text before is left alone");
  assert.match(out, /title="orange line"/);
});

test("an interchange gets one dot per line it actually serves", () => {
  /* Most interchanges serve two of the four lines, so the cluster is the
     information — Jean-Talon is orange and blue, not "an interchange". */
  const jt = hoodHtml({ hood: "Little Italy · métro Jean-Talon",
                        loc: { metro: "Jean-Talon", lines: ["orange", "blue"] } });
  assert.deepEqual(dotsIn(jt), ["orange", "blue"]);
  assert.match(jt, /title="orange \+ blue lines"/);

  const berri = hoodHtml({ hood: "métro Berri-UQAM",
                           loc: { metro: "Berri-UQAM", lines: ["green", "orange", "yellow"] } });
  assert.deepEqual(dotsIn(berri), ["green", "orange", "yellow"]);
});

test("dot order follows line order, not the order they were listed", () => {
  /* lib/metro.js stores interchange lines green, orange, yellow, blue, so
     a cluster always reads the same way round. */
  const snowdon = hoodHtml({ hood: "métro Snowdon",
                             loc: { metro: "Snowdon", lines: ["orange", "blue"] } });
  assert.deepEqual(dotsIn(snowdon), ["orange", "blue"]);
});

test("a station the table does not know renders exactly as before", () => {
  const plain = { hood: "Somewhere · métro Gare Centrale" };
  const withLoc = { hood: plain.hood, loc: { metro: "Gare Centrale", metroKey: "gare-centrale" } };
  assert.equal(hoodHtml(withLoc), hoodHtml(plain), "no lines known, so no claim made");
  assert.deepEqual(dotsIn(hoodHtml(withLoc)), []);
});

test("no loc, no metro, and an unknown station all fall back to plain text", () => {
  for (const item of [
    { hood: LAURIER },
    { hood: LAURIER, loc: {} },
    { hood: LAURIER, loc: { area: "Mile End" } },
    { hood: LAURIER, loc: { metro: "Laurier" } },             // no lines resolved
    { hood: LAURIER, loc: { metro: "Laurier", lines: [] } }
  ]) {
    assert.equal(hoodHtml(item), esc(LAURIER));
  }
});

test("a loc that disagrees with the string changes nothing", () => {
  /* Defensive: the station has to actually appear in the text. */
  const out = hoodHtml({ hood: "Plateau · 4848 boul. Saint-Laurent",
                         loc: { metro: "Laurier", lines: ["orange"] } });
  assert.equal(out, esc("Plateau · 4848 boul. Saint-Laurent"));
});

test("a trailing qualifier stays outside the tint", () => {
  const out = hoodHtml({ hood: "métro Montmorency then shuttle",
                         loc: { metro: "Montmorency", lines: ["orange"] } });
  assert.match(out, /métro Montmorency<\/span> then shuttle$/);
});

test("an empty hood yields nothing", () => {
  assert.equal(hoodHtml({}), "");
  assert.equal(hoodHtml({ hood: "" }), "");
});

test("every piece of the split string is still escaped", () => {
  const nasty = '<img src=x onerror=alert(1)> · métro Laurier · <b>after</b>';
  const out = hoodHtml({ hood: nasty, loc: { metro: "Laurier", lines: ["orange"] } });
  assert.ok(!out.includes("<img"), "text before the station must not survive as markup");
  assert.ok(!out.includes("<b>"), "text after the station must not either");
  assert.match(out, /&lt;img/);
  assert.match(out, /&lt;b&gt;after/);
});

test("the line name cannot inject an attribute", () => {
  const out = hoodHtml({ hood: LAURIER, loc: { metro: "Laurier", lines: ['orange" onload="x'] } });
  assert.ok(!out.includes('onload="x'), "the class value is escaped");
  assert.match(out, /&quot;/);
});
