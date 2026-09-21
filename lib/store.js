/* Documents live in Redis, photos live in Blob.

   Blob was the first choice for both, and it is wrong for documents:
   blob reads come off a CDN, so a poll landing just after a save can
   return the pre-write body. takeSpotted() replaces the collection
   wholesale from a snapshot, so a stale read makes a poster the owner
   just saved disappear from the board. Redis reads are consistent.

   Everything is namespaced under a secret salt. Blob URLs are public
   to anyone holding them, and a deterministic photo path would be
   guessable from the store host; the salt closes that. */

function salt() {
  const s = process.env.DOC_SALT;
  if (!s) throw new Error("DOC_SALT is not set");
  return s;
}

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis is not configured (KV_REST_API_URL / KV_REST_API_TOKEN)");
  return { url: url.replace(/\/+$/, ""), token };
}

/** Run one or more Redis commands. Returns an array of results. */
async function redis(commands) {
  const { url, token } = redisConfig();
  const single = !Array.isArray(commands[0]);
  const body = single ? commands : commands;
  const r = await fetch(single ? url : `${url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j && j.error) || `Redis returned ${r.status}`);
  const out = single ? [j] : j;
  for (const item of out) if (item && item.error) throw new Error(item.error);
  return out.map((i) => (i ? i.result : null));
}

/** Reject traversal and anything outside a conservative charset. */
export function cleanPath(p) {
  const s = String(p || "").replace(/^\/+|\/+$/g, "");
  if (!s || s.length > 200) return null;
  if (!/^[A-Za-z0-9_\-./]+$/.test(s)) return null;
  if (s.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return s;
}

const docKey = (p) => `doc:${salt()}:${p}`;
const colKey = (c) => `col:${salt()}:${c}`;
export const photoPrefix = () => `photos/${salt()}/`;
export const photoKey = (id) => `${photoPrefix()}${id}`;

function split(p) {
  const i = p.lastIndexOf("/");
  return i < 0 ? { col: null, id: p } : { col: p.slice(0, i), id: p.slice(i + 1) };
}

function parse(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

export async function getDoc(p) {
  const [v] = await redis(["GET", docKey(p)]);
  return parse(v);
}

export async function setDoc(p, data) {
  const { col, id } = split(p);
  const cmds = [["SET", docKey(p), JSON.stringify(data)]];
  if (col) cmds.push(["SADD", colKey(col), id]);
  await redis(cmds);
  return true;
}

export async function deleteDoc(p) {
  const { col, id } = split(p);
  const cmds = [["DEL", docKey(p)]];
  if (col) cmds.push(["SREM", colKey(col), id]);
  await redis(cmds);
  return true;
}

/** Every document directly under a collection. */
export async function listDocs(c) {
  const [ids] = await redis(["SMEMBERS", colKey(c)]);
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return [];
  const values = await redis(list.map((id) => ["GET", docKey(`${c}/${id}`)]));
  const out = [];
  const orphans = [];
  list.forEach((id, i) => {
    const data = parse(values[i]);
    if (data) out.push({ id, data });
    else orphans.push(id);
  });
  // a member whose document is gone would otherwise be read forever
  if (orphans.length) {
    redis([["SREM", colKey(c), ...orphans]]).catch(() => {});
  }
  return out;
}
