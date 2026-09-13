/** Vercel hands back a Buffer for known binary types and leaves the
    stream alone otherwise. Handle both. */
export async function rawBody(req, limitBytes = 8 * 1024 * 1024) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "binary");
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error("Body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
