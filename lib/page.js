/* Reading an event's web page, the server half. The board hands over a
   link; this fetches it, refuses anywhere a public page could not be, and
   boils the HTML down to what a reader needs: the title, the meta and
   Open Graph lines, any schema.org JSON-LD (where ticketing sites put the
   date, venue and price in plain fields), and the visible text.

   Pure apart from fetch and DNS, both injectable, so the tests run
   offline. */
import dns from "node:dns/promises";
import net from "node:net";

export const MAX_BYTES = 2 * 1024 * 1024;   /* of HTML read off the wire */
export const MAX_TEXT = 24000;              /* of text handed to the model */
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 12000;

/** An http(s) URL with no credentials and an ordinary port, or null. */
export function parsePageUrl(raw) {
  let s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.\-]*:/i.test(s)) s = "https://" + s.replace(/^\/\//, "");
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  if (!u.hostname || !u.hostname.includes(".") && !net.isIP(u.hostname)) return null;
  u.hash = "";
  return u;
}

/* Loopback, private, link-local (cloud metadata lives there), CGNAT,
   multicast and the reserved ranges, for both families. A page on the
   public web never resolves to one. */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateIp(mapped[1]);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true;
}

async function assertPublic(u, lookup) {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw Object.assign(new Error("That address is not a public web page."), { code: "blocked_url" });
  }
}

async function readCapped(r, limit) {
  if (!r.body || !r.body.getReader) {
    const t = await r.text();
    return t.length > limit ? t.slice(0, limit) : t;
  }
  const reader = r.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= limit) { try { await reader.cancel(); } catch {} break; }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, limit).toString("utf8");
}

/** Fetch a page, following redirects by hand so every hop is checked. */
export async function fetchPage(url, { fetchImpl = fetch, lookup = dns.lookup } = {}) {
  let u = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(u, lookup);
    let r;
    try {
      r = await fetchImpl(u.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; WeekendBoard/1.0; reads one event page on request)",
          "accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en-CA,en;q=0.9,fr-CA;q=0.8"
        }
      });
    } catch (e) {
      throw Object.assign(new Error("The page could not be reached."), { code: "fetch_failed", cause: e });
    }
    if (r.status >= 300 && r.status < 400) {
      const next = r.headers.get("location");
      const nu = next ? parsePageUrl(new URL(next, u).href) : null;
      if (!nu) throw Object.assign(new Error("The page redirected somewhere it can't be followed."), { code: "fetch_failed" });
      u = nu;
      continue;
    }
    if (!r.ok) throw Object.assign(new Error(`The page answered ${r.status}.`), { code: "fetch_failed", status: r.status });
    const type = (r.headers.get("content-type") || "").toLowerCase();
    if (type && !/html|xml|text\/plain/.test(type)) {
      throw Object.assign(new Error("That link is not a web page."), { code: "not_html" });
    }
    return { url: u.href, html: await readCapped(r, MAX_BYTES) };
  }
  throw Object.assign(new Error("Too many redirects."), { code: "fetch_failed" });
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    const v = ENTITIES[e.toLowerCase()];
    return v == null ? m : v;
  });
}

function attr(tag, name) {
  const m = new RegExp("\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : "";
}

const META_KEYS = /^(description|og:title|og:description|og:url|og:site_name|og:locale|twitter:title|twitter:description|event:|article:published_time)/i;

/** The parts of a page worth reading, as one block of text. */
export function extractPage(html) {
  const src = String(html || "");
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(src) || [])[1] || "").replace(/\s+/g, " ").trim();

  const meta = [];
  for (const m of src.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attr(m[0], "property") || attr(m[0], "name") || attr(m[0], "itemprop");
    const val = attr(m[0], "content");
    if (key && val && (META_KEYS.test(key) || /^(startDate|endDate|location|price)/i.test(key))) {
      meta.push(key + ": " + val.replace(/\s+/g, " ").trim());
    }
  }

  const ld = [];
  for (const m of src.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1].trim();
    if (body) ld.push(body.length > 8000 ? body.slice(0, 8000) : body);
  }

  const text = decodeEntities(src
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();

  return { title, meta, ld, text };
}

/** The extracted page as the text the model reads, capped. */
export function pageDigest(url, page) {
  const parts = ["URL: " + url];
  if (page.title) parts.push("Title: " + page.title);
  if (page.meta.length) parts.push("Meta tags:\n" + page.meta.join("\n"));
  if (page.ld.length) parts.push("Structured data (JSON-LD):\n" + page.ld.join("\n"));
  if (page.text) parts.push("Page text:\n" + page.text);
  const out = parts.join("\n\n");
  return out.length > MAX_TEXT ? out.slice(0, MAX_TEXT) + "\n[…page truncated]" : out;
}

/** Too little left to read: usually a page drawn entirely by script. */
export function isThin(page) {
  return !page.ld.length && !page.meta.length && page.text.length < 200;
}
