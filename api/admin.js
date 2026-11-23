// Owner-only. Send header x-admin-token: <ADMIN_TOKEN from Vercel env>.
// GET  /api/admin?view=proofs   → pending proofs with 10-minute private links to the award letters
// GET  /api/admin?view=radar    → latest 50 anonymised radar checks
// GET  /api/admin?view=captains → captains ranked by visits
// POST /api/admin { action:"approve"|"reject", id }
import { readBody, isAdmin, hasDb, sb, sbSignedUrl, limited } from "./_lib.js";

export default async function handler(req, res) {
  if (limited(req, "admin", 30)) return res.status(429).json({ error: "Slow down" });
  if (!isAdmin(req)) return res.status(401).json({ error: "Not allowed" });
  if (!hasDb()) return res.status(503).json({ error: "Database not configured" });
  try {
    if (req.method === "GET") {
      const view = String(req.query.view || "proofs");
      if (view === "proofs") {
        const { data } = await sb("proofs?select=id,created_at,first_name,country,programme,year,contact,file_path&status=eq.pending&order=created_at.asc&limit=50");
        const items = await Promise.all(data.map(async p => ({ ...p, url: await sbSignedUrl("proofs", p.file_path) })));
        return res.status(200).json({ items });
      }
      if (view === "radar") {
        const { data } = await sb("radar_checks?select=created_at,verdict,flags,snippet,source&order=created_at.desc&limit=50");
        return res.status(200).json({ items: data });
      }
      if (view === "captains") {
        const { data: caps } = await sb("captains?select=code,display_name,group_name,created_at&limit=500");
        const { data: ev } = await sb("ref_events?select=code,kind&limit=20000");
        const tally = {};
        for (const e of ev) { tally[e.code] ??= { visits: 0, shares: 0 }; tally[e.code][e.kind === "visit" ? "visits" : "shares"]++; }
        const items = caps.map(c => ({ ...c, ...(tally[c.code] || { visits: 0, shares: 0 }) })).sort((a, b) => b.visits - a.visits);
        return res.status(200).json({ items });
      }
      return res.status(400).json({ error: "Unknown view" });
    }
    if (req.method === "POST") {
      const b = readBody(req);
      if (!["approve", "reject"].includes(b.action) || !/^[0-9a-f-]{36}$/.test(String(b.id))) return res.status(400).json({ error: "Bad request" });
      await sb(`proofs?id=eq.${b.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: b.action === "approve" ? "approved" : "rejected", reviewed_at: new Date().toISOString() } });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "GET or POST" });
  } catch {
    return res.status(500).json({ error: "Something failed" });
  }
}
