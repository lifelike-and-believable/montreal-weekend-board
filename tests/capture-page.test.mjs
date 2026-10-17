/* Add a poster also takes a link to the event's page. The board side of
   that: the page prompt asks for exactly the poster's JSON, so one form
   takes either read; a record saved from a link says so, keeps the page,
   and links its title there when the page gave no ticket link; and its
   card says where it came from. Lifted from index.html. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build, html } from "./lift.mjs";

const esc = build("esc");
const okSrc = /var URL_OK = (\/.*\/[a-z]*);/.exec(html);
const normUrl = build("normUrl", { URL_OK: new Function("return " + okSrc[1])() });

test("the page prompt asks for the poster's shape, word for word", () => {
  const placeLabel = () => "";
  const poster = build("posterPromptHead", { placeLabel })();
  const page = build("pagePromptHead", { placeLabel })();
  const shape = (s) => s.slice(s.indexOf("Reply with only a JSON object"));
  assert.equal(shape(page), shape(poster));
  assert.match(page, /in or near Montreal, Quebec/);
  assert.match(build("pagePromptHead", { placeLabel: () => "Boston, MA" })(), /in or near Boston, MA/);
  assert.match(page, /Never invent a detail/);
});

test("the prompt is built at load, beside the poster's", () => {
  assert.ok(html.indexOf("var PAGE_PROMPT_HEAD = pagePromptHead()") > html.indexOf("var POSTER_PROMPT_HEAD = posterPromptHead()"));
});

/* readForm reads the dialog's inputs; hand it a stand-in document */
function formWith(values, { capPage = "", capEditing = null } = {}) {
  const document = { getElementById: (id) => ({ value: values[id] || "" }) };
  const pageLink = () => capPage || (capEditing && capEditing.pageUrl) || "";
  return build("readForm", { document, capPage, capEditing, newId: () => "id1", normUrl, pageLink })();
}

test("a record read from a link keeps the page and says where it came from", () => {
  const r = formWith({ "f-title": "Jazz", "f-start": "2026-10-24", "f-cat": "music" },
    { capPage: "https://upstairsjazz.com/e/1" });
  assert.equal(r.source, "page");
  assert.equal(r.pageUrl, "https://upstairsjazz.com/e/1");
  assert.equal(r.url, "https://upstairsjazz.com/e/1", "no ticket link: the title goes to the page");
  assert.equal(r.photoId, null);
});

test("a ticket link the page gave wins over the page itself", () => {
  const r = formWith({ "f-title": "Jazz", "f-url": "tixr.com/e/9" }, { capPage: "https://upstairsjazz.com/e/1" });
  assert.equal(r.url, "https://tixr.com/e/9");
  assert.equal(r.pageUrl, "https://upstairsjazz.com/e/1");
});

test("a poster stays a poster, and an edit keeps what the record was", () => {
  const poster = formWith({ "f-title": "Show" });
  assert.equal(poster.source, "poster");
  assert.equal(poster.pageUrl, null);
  assert.equal(poster.url, "");
  const editing = { id: "r1", source: "page", pageUrl: "https://x.org/e", capturedAt: "2026-10-01T00:00:00Z" };
  const edited = formWith({ "f-title": "Show" }, { capEditing: editing });
  assert.equal(edited.id, "r1");
  assert.equal(edited.source, "page");
  assert.equal(edited.pageUrl, "https://x.org/e");
  assert.equal(edited.url, "https://x.org/e");
});

test("the edit form does not show the page as its own ticket link", () => {
  const vals = {};
  const document = { getElementById: (id) => ({ set value(v) { vals[id] = v; } }) };
  const fill = build("fillForm", { document, CATMAP: { music: {} } });
  fill({ cat: "music", url: "https://x.org/e", pageUrl: "https://x.org/e" });
  assert.equal(vals["f-url"], "");
  fill({ cat: "music", url: "https://tixr.com/e/9", pageUrl: "https://x.org/e" });
  assert.equal(vals["f-url"], "https://tixr.com/e/9");
});

test("the card says it came from a page", () => {
  const tagsFor = build("tagsFor", { esc, CATMAP: { music: { color: "#000", label: "Music" } } });
  assert.match(tagsFor({ cat: "music", spotted: true, source: "page" }), /From a web page/);
  assert.match(tagsFor({ cat: "music", spotted: true }), /From a poster/);
  assert.match(tagsFor({ cat: "music", fromPoster: true, fromPage: true }), /Your link, now listed/);
  assert.match(tagsFor({ cat: "music", fromPoster: true }), /Poster, now listed/);
});

test("the link row sits in the dialog and is wired to the reader", () => {
  assert.match(html, /<form class="cap-link" id="cap-link" novalidate>/);
  assert.match(html, /getElementById\("cap-link"\)\.addEventListener\("submit"/);
  assert.match(html, /ns\.page\(prompt, url, \{ signal: capAbort\.signal \}\)/);
});
