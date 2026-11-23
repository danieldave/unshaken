// GET  /api/proof → approved winners (first name, country, programme, year only)
// POST /api/proof { first_name, country, programme, year, contact?, file (data URL), consent:true } → pending review
import { readBody, limited, clip, hasDb, sb, sbUpload, code } from "./_lib.js";

const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const MAX_BYTES = 3_000_000;

export default async function handler(req, res) {
  if (!hasDb()) return res.status(req.method === "GET" ? 200 : 503).json(req.method === "GET" ? { enabled: false, items: [] } : { error: "Proof Wall not configured" });

  if (req.method === "GET") {
    try {
      const { data } = await sb("proofs?select=first_name,country,programme,year,reviewed_at&status=eq.approved&order=reviewed_at.desc&limit=60");
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(200).json({ enabled: true, items: data });
    } catch { return res.status(200).json({ enabled: false, items: [] }); }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
  if (limited(req, "proof", 3, 10 * 60_000)) return res.status(429).json({ error: "Too many uploads. Try later." });
  const b = readBody(req);
  if (b.consent !== true) return res.status(400).json({ error: "Please tick the consent box." });
  const first_name = clip(b.first_name, 40).split(/\s+/)[0];
  const country = clip(b.country, 60), programme = clip(b.programme, 120), year = Number(b.year) || null, contact = clip(b.contact, 120) || null;
  if (!first_name || country.length < 2 || programme.length < 2) return res.status(400).json({ error: "First name, country and programme are required." });
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(b.file || ""));
  if (!m || !TYPES[m[1]]) return res.status(400).json({ error: "Upload a JPG, PNG, WEBP or PDF of the award letter." });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_BYTES) return res.status(400).json({ error: "File too large (max 3 MB)." });

  try {
    const path = `${new Date().toISOString().slice(0, 10)}/${code(12)}.${TYPES[m[1]]}`;
    await sbUpload("proofs", path, buf, m[1]);
    await sb("proofs", { method: "POST", prefer: "return=minimal", body: { first_name, country, programme, year, contact, file_path: path } });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Upload failed. Try again." });
  }
}
