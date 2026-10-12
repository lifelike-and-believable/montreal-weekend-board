/* The guide to a place, as the board shows it: read-only, only in travel
   mode, and never a way into the page for what a note says. Lifted from
   index.html so what runs here is what ships. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { build, html } from "./lift.mjs";
import { boardGuide } from "../lib/ledger.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const section = build("guideSectionHtml", { esc });
const personal = build("guidePersonalHtml", { esc });
const meta = build("guideMeta", {});
const body = build("guideHtml", { guideSectionHtml: section, guidePersonalHtml: personal });

const G = {
  visits: 2, lastVisitedAt: "2026-09-13",
  guide: {
    areas: [{ name: "Williamsburg", note: "venues and bars, L train" }],
    transit: [{ note: "OMNY tap-to-pay on the subway" }],
    stays: [], tips: [{ name: "Cash", note: "some venues are cash-light" }]
  },
  personal: [{ title: "Hadestown", venue: "Walter Kerr", via: "star" }, { title: "Comedy Cellar", venue: "", via: "add" }]
};

test("a section shows its notes, named ones in bold, and nothing when it has none", () => {
  const h = section("Where to be", G.guide.areas);
  assert.match(h, /<h3>Where to be<\/h3>/);
  assert.match(h, /<b>Williamsburg<\/b> — venues and bars, L train/);
  assert.match(section("Getting around", G.guide.transit), /<li>OMNY tap-to-pay on the subway<\/li>/);
  assert.equal(section("Where to stay", []), "");
  assert.equal(section("Where to stay", null), "");
  assert.equal(section("x", [null, {}, { name: " ", note: "" }]), "");
});

test("what a note says cannot reach the page as markup", () => {
  const h = section("Tips", [{ name: "<img src=x onerror=alert(1)>", note: "</li><script>x()</script>" }]);
  assert.ok(!h.includes("<img") && !h.includes("<script"), h);
  assert.match(personal([{ title: "<b onclick=x>", venue: "\"><i>", via: "add" }]), /&lt;b onclick=x&gt;/);
});

test("the owner's earlier picks say whether they were starred or added, and where", () => {
  const h = personal(G.personal);
  assert.match(h, /<b>Hadestown<\/b> <span class="guide-via">starred · Walter Kerr<\/span>/);
  assert.match(h, /<b>Comedy Cellar<\/b> <span class="guide-via">added<\/span>/);
  assert.equal(personal([]), "");
  assert.equal(personal(Array.from({ length: 20 }, (_, i) => ({ title: "t" + i, via: "add" }))).split("<li>").length - 1, 8);
});

test("the heading says how often they have been, and when last", () => {
  assert.equal(meta(null), "First visit");
  assert.equal(meta({ visits: 0 }), "First visit");
  assert.match(meta({ visits: 1, lastVisitedAt: "2026-09-13" }), /^Been here once before · last in Sep(t)?\.? 2026$/);
  assert.match(meta({ visits: 2 }), /^Been here twice before$/);
  assert.match(meta({ visits: 5, lastVisitedAt: "junk" }), /^Been here 5 times before$/);
});

test("the body is every section with something in it, and empty when there is nothing", () => {
  const h = body(G);
  for (const t of ["Where to be", "Getting around", "Good to know", "From your earlier trips"]) assert.ok(h.includes(t), t);
  assert.ok(!h.includes("Where to stay"), "an empty section is left out");
  assert.equal(body(null), "");
  assert.equal(body({ guide: {}, personal: [] }), "");
});

test("applyGuide shows the panel in travel mode, and hides it at home or with nothing to show", () => {
  const els = {};
  const el = (id) => (els[id] = els[id] || { hidden: true, textContent: "", innerHTML: "" });
  const document = { getElementById: (id) => el(id) };
  const run = (label, GUIDE) => {
    Object.keys(els).forEach((k) => delete els[k]);
    el("guide");
    build("applyGuide", { document, placeLabel: () => label, guideHtml: body, guideMeta: meta, GUIDE })();
    return els;
  };
  const away = run("New York, NY", G);
  assert.equal(away.guide.hidden, false);
  assert.equal(away["guide-title"].textContent, "Guide to New York, NY");
  assert.match(away["guide-meta"].textContent, /Been here twice before/);
  assert.match(away["guide-body"].innerHTML, /Williamsburg/);
  assert.equal(run("", G).guide.hidden, true, "at home");
  assert.equal(run("New York, NY", null).guide.hidden, true, "no guide yet");
});

test("the markup is a closed, hidden details element above the footer", () => {
  assert.match(html, /<section class="guide" id="guide" hidden>\s*<details class="guide-box">/);
  assert.ok(html.indexOf('id="guide"') < html.indexOf('<footer class="foot">'));
  assert.ok(!/<details class="guide-box"[^>]*open/.test(html), "folded until opened");
});

test("boardGuide gives names and notes only, and null when there is nothing", () => {
  assert.equal(boardGuide(null, "2026-10-17"), null);
  assert.equal(boardGuide({ visits: [{ weekendId: "2026-09-12", from: "2026-09-12", to: "2026-09-13" }] }, "2026-10-17"), null);
  const doc = {
    visits: [{ weekendId: "2026-09-12", from: "2026-09-11", to: "2026-09-13" }],
    guide: { areas: [{ name: "Chelsea", note: "galleries", at: "2026-09-12T00:00:00Z" }] },
    personal: [{ title: "Hadestown", cat: "theatre", venue: "Walter Kerr", sub: "", weekend: "2026-09-12", via: "star", at: "2026-09-10T00:00:00Z" }]
  };
  const g = boardGuide(doc, "2026-10-17");
  assert.equal(g.visits, 1);
  assert.equal(g.lastVisitedAt, "2026-09-13");
  assert.deepEqual(g.guide.areas, [{ name: "Chelsea", note: "galleries" }]);
  assert.deepEqual(g.personal, [{ title: "Hadestown", venue: "Walter Kerr", via: "star" }]);
  assert.deepEqual(Object.keys(g.guide).sort(), ["areas", "stays", "tips", "transit"]);
});
