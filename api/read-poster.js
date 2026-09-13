import { gate } from "../lib/auth.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

/** Models sometimes wrap JSON in prose or a code fence. Dig it out. */
function parseJson(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!gate(req, res)) return;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ code: "no_key", error: "ANTHROPIC_API_KEY is not set" });

  const { prompt, mediaType, data } = req.body || {};
  if (!prompt || !data) return res.status(400).json({ code: "bad_request", error: "prompt and data required" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1400,
        system: "You read event posters and return a single JSON object. Return only JSON, no prose and no code fence. Never invent a field: omit anything the poster does not state.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });

    const j = await r.json();
    if (!r.ok) {
      console.error("[read-poster] anthropic", r.status, JSON.stringify(j).slice(0, 400));
      return res.status(502).json({
        code: "model_error",
        error: (j && j.error && j.error.message) || `Anthropic returned ${r.status}`
      });
    }

    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const result = parseJson(text);
    if (!result) return res.status(502).json({ code: "invalid_json", error: "Could not parse a result from the poster." });

    return res.status(200).json({ result });
  } catch (e) {
    console.error("[read-poster]", e);
    return res.status(500).json({ code: "read_failed", error: String(e.message || e) });
  }
}
