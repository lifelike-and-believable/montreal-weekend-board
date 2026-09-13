import { safeEqual, issueCookie, clearCookie } from "../lib/auth.js";

export default function handler(req, res) {
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearCookie());
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const want = process.env.BOARD_PASSCODE;
  if (!want) return res.status(500).json({ error: "BOARD_PASSCODE is not set" });

  const given = (req.body && req.body.passcode) || "";
  if (!given || !safeEqual(given, want)) {
    return res.status(401).json({ code: "bad_passcode", error: "That passcode doesn't match." });
  }
  res.setHeader("Set-Cookie", issueCookie());
  return res.status(200).json({ ok: true });
}
