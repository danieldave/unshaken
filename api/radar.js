// GET /api/radar  →  public Scam Radar summary for the last 7 days (no message text is ever returned)
import { hasDb, sb } from "./_lib.js";

let cache = { at: 0, data: null };

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!hasDb()) return res.status(200).json({ enabled: false });
  if (Date.now() - cache.at < 5 * 60_000 && cache.data) return res.status(200).json(cache.data);
  try {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data } = await sb(`radar_checks?select=verdict,flags,text_hash&created_at=gte.${since}&limit=5000`);
    const byVerdict = { green: 0, orange: 0, red: 0 }, flags = {}, hashes = {};
    for (const r of data) {
      byVerdict[r.verdict]++;
      for (const f of r.flags || []) flags[f] = (flags[f] || 0) + 1;
      hashes[r.text_hash] = (hashes[r.text_hash] || 0) + 1;
    }
    const out = {
      enabled: true,
      days: 7,
      total: data.length,
      byVerdict,
      topFlags: Object.entries(flags).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([flag, count]) => ({ flag, count })),
      repeatedMessages: Object.values(hashes).filter(n => n > 1).length
    };
    cache = { at: Date.now(), data: out };
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json(out);
  } catch {
    return res.status(200).json({ enabled: false });
  }
}
