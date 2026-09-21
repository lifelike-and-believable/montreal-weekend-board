/* A link read off a poster arrives as the poster printed it —
   "jackalope.co/festival", no scheme. Handed straight to an href that is
   a path on this site, so the single most useful thing on the card opens
   a page of our own that does not exist. normUrl is what stands between
   the two, and titleLink is what happens when there is no link at all. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { html, build } from "./lift.mjs";

const okSrc = /var URL_OK = (\/.*\/[a-z]*);/.exec(html);
assert.ok(okSrc, "URL_OK not found in index.html");
const URL_OK = new Function("return " + okSrc[1])();

const esc = build("esc");
const normUrl = build("normUrl", { URL_OK });
const titleLink = build("titleLink", { esc, normUrl });

test("a bare host gets the scheme the poster left off", () => {
  assert.equal(normUrl("jackalope.co/pages/festival"), "https://jackalope.co/pages/festival");
  assert.equal(normUrl("www.casadelpopolo.com"), "https://www.casadelpopolo.com");
  assert.equal(normUrl("tixr.com/e/194404"), "https://tixr.com/e/194404");
  assert.equal(normUrl("quartiersdanses.com/en/?lang=en"), "https://quartiersdanses.com/en/?lang=en");
  assert.equal(normUrl("musee-mccord-stewart.ca"), "https://musee-mccord-stewart.ca");
});

test("a link that already has one is passed through as typed", () => {
  for (const u of ["https://phi.ca/en/whats-on/", "http://evenko.ca/e?code=1",
                   "HTTPS://MBAM.QC.CA", "mailto:box@venue.ca", "tel:+15145551234"]) {
    assert.equal(normUrl(u), u);
  }
});

test("a protocol-relative link is completed, not prefixed twice", () => {
  assert.equal(normUrl("//cdn.example.com/poster"), "https://cdn.example.com/poster");
});

test("surrounding punctuation and whitespace come off", () => {
  assert.equal(normUrl("  jackalope.co  "), "https://jackalope.co");
  assert.equal(normUrl("(casadelpopolo.com)"), "https://casadelpopolo.com");
  assert.equal(normUrl("<https://phi.ca>"), "https://phi.ca");
});

test("what is not a link becomes no link", () => {
  /* A poster's "url" line is often not a URL at all. Prefixing those with
     https:// would make a card that looks clickable and is not. */
  for (const v of ["", null, undefined, "   ", "see the poster", "@venue_mtl",
                   "Tickets at the door", "8 p.m."]) {
    assert.equal(normUrl(v), "");
  }
});

test("a scheme the board has no use for is dropped", () => {
  for (const v of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>",
                   "vbscript:x", "file:///etc/passwd", "blob:https://x/y",
                   "localhost:3000/x", "Info: 514-555-1234"]) {
    assert.equal(normUrl(v), "", v + " must not survive as a link");
  }
});

test("a title with somewhere to go is a link, and one without is text", () => {
  const withUrl = titleLink({ title: "JACKALOPE", url: "jackalope.co/festival" });
  assert.match(withUrl, /^<a href="https:\/\/jackalope\.co\/festival"/);
  assert.match(withUrl, /target="_blank" rel="noopener"/);
  assert.match(withUrl, />JACKALOPE<\/a>$/);

  assert.equal(titleLink({ title: "Poster with no link", url: "" }), "Poster with no link");
  assert.equal(titleLink({ title: "Nor this one" }), "Nor this one");
});

test("neither the url nor the title can break out of the markup", () => {
  const out = titleLink({ title: '<img src=x onerror=alert(1)>', url: 'x.com/"onmouseover="a' });
  assert.ok(!out.includes("<img"), "the title is escaped");
  assert.ok(!out.includes('"onmouseover="a'), "the href is escaped");
  assert.match(out, /&quot;/);
  assert.equal(titleLink({ title: "x", url: "javascript:alert(1)" }), "x",
    "a refused scheme leaves a title, not a link");
});

test("every place a record is written passes its url through normUrl", () => {
  /* The board renders stored records verbatim, so a record saved before
     this existed still has to come out with a scheme on it. */
  for (const site of ['url: normUrl(g("f-url"))',           // the capture form
                      'url: normUrl(d.url)',                 // the poster read
                      'url: normUrl(rec.url)',               // spotted -> event
                      'title: rec.title, url: normUrl(rec.url)']) {  // spotted -> standing
    assert.ok(html.includes(site), "missing: " + site);
  }
  assert.ok(!/href="' \+ esc\([a-z]+\.url\)/.test(html),
    "no card may build an href straight out of a stored url");
});
