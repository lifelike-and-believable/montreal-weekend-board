import { list } from "@vercel/blob";
import { gate } from "../lib/auth.js";
import { photoKey } from "../lib/store.js";

/* Serves /_blob/<photoId> — the artifact runtime's asset URL scheme.

   The board builds photo URLs as "/_blob/" + photoId in three places
   (the Coming up thumbnail, the Waiting to be read thumbnail, and the
   photo in the edit dialog). That path existed inside the claude.ai
   host and does not exist here, so every poster photo rendered broken.

   Rather than edit the board — which would forfeit the byte-identity
   of its code against the artifact source — this reimplements the path.
   A vercel.json rewrite maps /_blob/:id here.

   Redirects to the Blob URL rather than streaming: the pathname is
   namespaced under the secret DOC_SALT and only an authenticated
   caller ever learns it. */
export default async function handler(req, res) {
  if (!gate(req, res)) return;

  const id = String((req.query && req.query.id) || "");
  if (!id || !/^[A-Za-z0-9_\-.]{1,120}$/.test(id) || id.includes("..")) {
    return res.status(400).json({ code: "bad_id", error: "Invalid photo id" });
  }

  try {
    const pathname = photoKey(id);
    const { blobs } = await list({ prefix: pathname, limit: 1 });
    const hit = blobs.find((b) => b.pathname === pathname);
    if (!hit) return res.status(404).json({ code: "not_found", error: "No such photo" });

    res.setHeader("Cache-Control", "private, max-age=3600");
    res.redirect(302, hit.url);
  } catch (e) {
    console.error("[blob]", id, e);
    return res.status(500).json({ code: "blob_error", error: String(e.message || e) });
  }
}
