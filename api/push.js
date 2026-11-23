// GET  /api/push                                   → { publicKey } for the browser to subscribe
// POST /api/push { subscription, items[], lang }   → save or update this phone's alerts (no account)
// POST /api/push { action:"off", endpoint }        → stop alerts for this phone
import { readBody, limited, clip, hasDb, sb } from "./_lib.js";

const okEndpoint = u => /^https:\/\/[\w.-]+(:\d+)?\/\S{10,}$/.test(String(u || "")) && String(u).length < 1000;

export default async function handler(req, res) {
  const pub = process.env.VAPID_PUBLIC_KEY;
  if (req.method === "GET") return res.status(200).json({ enabled: Boolean(pub && process.env.VAPID_PRIVATE_KEY && hasDb()), publicKey: pub || null });
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
  if (!hasDb() || !pub) return res.status(503).json({ error: "Alerts not configured" });
  if (limited(req, "push", 20)) return res.status(429).json({ error: "Slow down" });
  const b = readBody(req);
  try {
    if (b.action === "off") {
      if (!okEndpoint(b.endpoint)) return res.status(400).json({ error: "Bad request" });
      await sb(`push_subs?endpoint=eq.${encodeURIComponent(b.endpoint)}`, { method: "DELETE", prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    const sub = b.subscription || {};
    if (!okEndpoint(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return res.status(400).json({ error: "Bad subscription" });
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map(x => clip(x, 40)).filter(x => /^[\w-]+$/.test(x));
    await sb("push_subs", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: {
      endpoint: sub.endpoint, keys: { p256dh: clip(sub.keys.p256dh, 200), auth: clip(sub.keys.auth, 100) }, items, lang: clip(b.lang, 4) || null, updated_at: new Date().toISOString()
    }});
    return res.status(200).json({ ok: true, items: items.length });
  } catch { return res.status(500).json({ error: "Try again" }); }
}
