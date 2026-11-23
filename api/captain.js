// POST /api/captain { display_name?, group_name? }        → new captain { code, secret }
// GET  /api/captain?code=XXX&secret=YYY                   → that captain's stats + ladder level
// POST /api/captain { action:"event", code, kind, device } → count a visit or share (one per device)
import { readBody, limited, clip, hasDb, sb, code as makeCode, secret as makeSecret } from "./_lib.js";

export const LEVELS = [
  { name: "Starter", min: 0 }, { name: "Connector", min: 10 }, { name: "Captain", min: 50 }, { name: "Gold OG", min: 200 }
];
const levelOf = n => [...LEVELS].reverse().find(l => n >= l.min);

export default async function handler(req, res) {
  if (!hasDb()) return res.status(503).json({ error: "Captains not configured" });

  if (req.method === "GET") {
    const c = clip(req.query.code, 12).toUpperCase(), s = clip(req.query.secret, 40);
    try {
      const { data } = await sb(`captains?select=code,display_name,group_name,secret,created_at&code=eq.${encodeURIComponent(c)}`);
      if (!data[0] || data[0].secret !== s) return res.status(404).json({ error: "Not found" });
      const visits = (await sb(`ref_events?select=id&code=eq.${c}&kind=eq.visit`, { headers: { Prefer: "count=exact", Range: "0-0" } })).count;
      const shares = (await sb(`ref_events?select=id&code=eq.${c}&kind=eq.share`, { headers: { Prefer: "count=exact", Range: "0-0" } })).count;
      const lvl = levelOf(visits), next = LEVELS.find(l => l.min > visits);
      return res.status(200).json({ code: c, display_name: data[0].display_name, group_name: data[0].group_name, visits, shares, level: lvl.name, next: next ? { name: next.name, need: next.min - visits } : null });
    } catch { return res.status(500).json({ error: "Try again" }); }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
  const b = readBody(req);

  if (b.action === "event") {
    if (limited(req, "ref", 20)) return res.status(429).json({ ok: false });
    const c = clip(b.code, 12).toUpperCase(), kind = b.kind === "share" ? "share" : "visit", device = clip(b.device, 40);
    if (!/^[A-Z0-9]{4,12}$/.test(c) || device.length < 8) return res.status(400).json({ ok: false });
    try {
      await sb("ref_events", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { code: c, kind, device } });
    } catch {}
    return res.status(200).json({ ok: true });
  }

  if (limited(req, "captain-new", 3, 10 * 60_000)) return res.status(429).json({ error: "Try again later." });
  const row = { code: makeCode(6), secret: makeSecret(), display_name: clip(b.display_name, 40) || null, group_name: clip(b.group_name, 80) || null };
  try {
    await sb("captains", { method: "POST", prefer: "return=minimal", body: row });
    return res.status(200).json({ code: row.code, secret: row.secret });
  } catch { return res.status(500).json({ error: "Try again" }); }
}
