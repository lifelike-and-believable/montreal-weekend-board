import crypto from "node:crypto";

const COOKIE = "board_auth";
const YEAR = 60 * 60 * 24 * 365;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Constant-time compare of two arbitrary-length strings. */
export function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function issueCookie() {
  const payload = `1.${Date.now()}`;
  const token = `${payload}.${sign(payload)}`;
  return [
    `${COOKIE}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${YEAR}`
  ].join("; ");
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** True when the request carries a valid, unexpired session cookie. */
export function isAuthed(req) {
  try {
    const token = readCookie(req, COOKIE);
    if (!token) return false;
    const i = token.lastIndexOf(".");
    if (i < 0) return false;
    const payload = token.slice(0, i);
    const mac = token.slice(i + 1);
    if (!safeEqual(mac, sign(payload))) return false;
    const issued = Number(payload.split(".")[1] || 0);
    return Number.isFinite(issued) && Date.now() - issued < YEAR * 1000;
  } catch {
    return false;
  }
}

/** Bearer-token auth for the daily refresh job. */
export function isRefreshJob(req) {
  const want = process.env.REFRESH_SECRET;
  if (!want) return false;
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return !!got && safeEqual(got, want);
}

/** Gate a handler. Returns true when the request may proceed. */
export function gate(req, res) {
  if (isAuthed(req) || isRefreshJob(req)) return true;
  res.status(401).json({ code: "permission_denied", error: "not signed in" });
  return false;
}
