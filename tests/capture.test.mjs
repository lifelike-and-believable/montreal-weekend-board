/* Phase 4 removed three things the port had carried since the artifact:
   thaw(), the inline photo copy, and the idea that a poster gets read
   later. The last is the one worth guarding — nothing in api/ or lib/
   ever reads a spotted record, so any wording that promises a later read
   is a promise the app cannot keep. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const board = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const shim = fs.readFileSync(new URL("../public/claude-shim.js", import.meta.url), "utf8");
const serverFiles = ["api/refresh.js", "api/data.js", "api/db.js", "lib/prune.js"]
  .map((f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8"));

test("thaw() is gone", () => {
  assert.ok(!/\bthaw\s*\(/.test(board), "no calls");
  assert.ok(!board.includes("function thaw"), "no definition");
});

test("removing it is safe because nothing freezes a snapshot", () => {
  /* thaw() existed because the artifact host froze every document it
     handed back, and writing to one threw under strict mode. This shim
     does not, which is the whole licence for deleting it — if a freeze
     is ever added here, the defensive copy has to come back. */
  assert.ok(!shim.includes("Object.freeze"), "the shim must not freeze snapshot bodies");
  assert.ok(!shim.includes("Object.isFrozen"));
  assert.ok(shim.includes("return data || {}"), "data() hands back the parsed object as-is");
});

test("the inline base64 photo copy is gone", () => {
  assert.ok(!board.includes("photoData"), "records carry photoId only");
  assert.ok(!board.includes("thumbDataUrl"), "and nothing builds a copy");
});

test("photos are still shown, from the blob path", () => {
  const uses = board.match(/"\/_blob\/" \+ (r|rec)\.photoId/g) || [];
  assert.ok(uses.length >= 2, "the pending card and the edit dialog both show one");
});

test("needsRead survives as a state, not a queue", () => {
  assert.ok(board.includes("rec.needsRead ="), "still set on save");
  assert.ok(board.includes("if (rec.needsRead) return;"), "still held off the board");
});

test("nothing in the app promises a later read", () => {
  /* The read is synchronous, in capReadPoster. There is no second pass. */
  for (const phrase of ["morning refresh reads", "Queued for the morning",
                        "will read the poster", "no date read yet",
                        "until the poster has been read"]) {
    assert.ok(!board.includes(phrase), "stale promise: " + phrase);
  }
});

test("and no server code could keep such a promise anyway", () => {
  for (const src of serverFiles) {
    assert.ok(!src.includes("needsRead"),
      "no server path inspects a pending poster; if one is added, the wording can change back");
  }
});

test("the save tells you what it actually needs", () => {
  assert.match(board, /add a title and a date to put it on the board/);
});
