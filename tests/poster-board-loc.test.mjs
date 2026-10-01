/* The board's poster records have to carry `loc` through to the entries
   it builds from them, or hoodHtml has nothing to colour. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "./lift.mjs";

const deps = { normUrl: (u) => u || null, prettyDate: (d) => d };
const asEvent = build("spottedAsEvent", deps);
const asStanding = build("spottedAsStanding", deps);
const loc = { metro: "Laurier", lines: ["orange"] };

test("poster events and runs keep their loc", () => {
  const rec = { id: "x", title: "Art Book Fair", hood: "Mile End · métro Laurier", loc, startDate: "2026-10-02", endDate: "2026-10-04" };
  assert.deepEqual(asEvent(rec, "sat").loc, loc);
  assert.deepEqual(asStanding(rec).loc, loc);
  assert.equal(asEvent({ id: "y", title: "t" }, "sat").loc, null);
});

test("a hand-typed station without the accent still gets its dot", () => {
  const esc = build("esc");
  const hoodHtml = build("hoodHtml", { esc });
  const html = hoodHtml({ hood: "Mile End · Metro Laurier", loc });
  assert.match(html, /<span class="mdot is-orange"><\/span><\/span>Metro Laurier<\/span>/);
  assert.match(html, /^Mile End · /);
});
