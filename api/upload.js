import { put } from "@vercel/blob";
import { gate } from "../lib/auth.js";
import { photoKey } from "../lib/store.js";
import { rawBody } from "../lib/rawbody.js";

export const config = { api: { bodyParser: false } };

const EXT = {
  "image/jpeg": "jpg", "image/png": "png",
  "image/webp": "webp", "image/gif": "gif"
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!gate(req, res)) return;

  try {
    const type = (req.headers["x-photo-type"] || "image/jpeg").toLowerCase();
    const ext = EXT[type] || "jpg";
    const body = await rawBody(req);
    if (!body.length) return res.status(400).json({ code: "empty", error: "No image data" });

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const blob = await put(photoKey(id), body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: type
    });
    return res.status(200).json({ id, url: blob.url });
  } catch (e) {
    console.error("[upload]", e);
    return res.status(500).json({ code: "upload_failed", error: String(e.message || e) });
  }
}
