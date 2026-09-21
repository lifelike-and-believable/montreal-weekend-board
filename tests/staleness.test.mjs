/* The freshness banner is the only thing on the page that can tell a
   reader the weekend on screen is not the weekend they are in, so its
   decisions are worth pinning down. The script under test is lifted
   straight out of the shell, which also proves it stays extractable —
   it must never reach into the board's own scope. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

/* The shell's banner script: the one carrying __BOARD_FRESH__. */
const blocks = html.split("<script>").slice(1).map((b) => b.split("</script>")[0]);
const source = blocks.find((b) => b.includes("__BOARD_FRESH__") && b.includes('"stale"'));
assert.ok(source, "banner script not found in index.html");

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);

function render(fresh, { online = true } = {}) {
  const el = { innerHTML: "", hidden: true };
  const win = {};
  if (fresh !== undefined) win.__BOARD_FRESH__ = fresh;
  const doc = { getElementById: (id) => (id === "stale" ? el : null) };
  new Function("window", "document", "navigator", source)(
    win, doc, { onLine: online });
  return el;
}

test("says nothing when the board is this weekend's", () => {
  const el = render({ status: "ok", label: "Sat 3 - Sun 4",
                      lastDay: iso(Date.now() + 2 * DAY), updatedAt: new Date().toISOString() });
  assert.equal(el.hidden, true);
  assert.equal(el.innerHTML, "");
});

test("still says nothing on the final day of the weekend", () => {
  const el = render({ status: "ok", lastDay: iso(Date.now()), label: "today" });
  assert.equal(el.hidden, true, "the last day is not yet past");
});

test("warns once the weekend it covers has passed", () => {
  const el = render({ status: "ok", label: "Sat 12 - Sun 13 September",
                      lastDay: iso(Date.now() - 9 * DAY),
                      updatedAt: new Date(Date.now() - 9 * DAY).toISOString() });
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /not this weekend's board/);
  assert.match(el.innerHTML, /Sat 12 - Sun 13 September/);
  assert.match(el.innerHTML, /9 days ago/);
});

test("stays quiet when signed out — the gate owns that screen", () => {
  const el = render({ status: "signed_out" });
  assert.equal(el.hidden, true);
});

test("flags the shipped sample listings when no refresh has landed", () => {
  const el = render({ status: "empty" });
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /listings this app shipped with/);
  assert.match(el.innerHTML, /has not landed/);
});

test("names the store when the store is the problem", () => {
  const el = render({ status: "store_error" });
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /store could not be reached/);
});

test("explains itself when the listings script never loaded offline", () => {
  const el = render(undefined, { online: false });
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /offline/);
});

test("falls back to the plain message when the script never loaded online", () => {
  const el = render(undefined, { online: true });
  assert.equal(el.hidden, false);
  assert.match(el.innerHTML, /has not landed/);
});

test("escapes a label so stored text cannot inject markup", () => {
  const el = render({ status: "ok", lastDay: iso(Date.now() - 5 * DAY),
                      label: '<img src=x onerror=alert(1)>' });
  assert.ok(!el.innerHTML.includes("<img"), "label must not survive as markup");
  assert.match(el.innerHTML, /&lt;img/);
});
