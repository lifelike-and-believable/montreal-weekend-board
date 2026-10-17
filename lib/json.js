/** Models sometimes wrap JSON in prose or a code fence. Dig it out. */
export function parseJson(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}
