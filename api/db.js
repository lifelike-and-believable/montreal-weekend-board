import { gate } from "../lib/auth.js";
import { cleanPath, getDoc, setDoc, deleteDoc, listDocs } from "../lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!gate(req, res)) return;

  const { op, path, data } = req.body || {};
  const p = cleanPath(path);
  if (!p) return res.status(400).json({ code: "bad_path", error: "Invalid path" });

  try {
    if (op === "get") {
      const doc = await getDoc(p);
      return res.status(200).json({ id: p.split("/").pop(), data: doc });
    }
    if (op === "list") {
      return res.status(200).json({ docs: await listDocs(p) });
    }
    if (op === "set") {
      if (!data || typeof data !== "object") {
        return res.status(400).json({ code: "bad_data", error: "data must be an object" });
      }
      await setDoc(p, data);
      return res.status(200).json({ ok: true });
    }
    if (op === "delete") {
      await deleteDoc(p);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ code: "bad_op", error: `Unknown op ${op}` });
  } catch (e) {
    console.error("[db]", op, p, e);
    return res.status(500).json({ code: "store_error", error: String(e.message || e) });
  }
}
