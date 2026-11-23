// Runs daily (vercel.json "crons"). Sends a push 7 days and 1 day before each saved deadline.
// Vercel calls it with "Authorization: Bearer <CRON_SECRET>".
import webpush from "web-push";
import { hasDb, sb } from "./_lib.js";

const MSG = {
  en: (d, title) => ({ title: d === 1 ? "Closes tomorrow" : "One week left", body: `${title}: ${d === 1 ? "last day to finish your application." : "7 days to the deadline. Open your sprint."}` }),
  pcm: (d, title) => ({ title: d === 1 ? "E go close tomorrow" : "One week remain", body: `${title}: ${d === 1 ? "na last day to finish your application o." : "7 days remain. Open your sprint."}` }),
  fr: (d, title) => ({ title: d === 1 ? "Ferme demain" : "Plus qu'une semaine", body: `${title} : ${d === 1 ? "dernier jour pour finaliser votre candidature." : "7 jours avant la date limite. Ouvrez votre sprint."}` })
};

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: "Not allowed" });
  if (!hasDb() || !process.env.VAPID_PRIVATE_KEY) return res.status(503).json({ error: "Not configured" });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const site = process.env.SITE_URL || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL}`;
  const data = await fetch(`${site}/data/listings.json`).then(r => r.json());
  const byId = Object.fromEntries(data.items.map(i => [i.id, i]));
  const { data: subs } = await sb("push_subs?select=endpoint,keys,items,lang,sent&limit=5000");

  let sent = 0, removed = 0;
  for (const s of subs) {
    const marks = { ...(s.sent || {}) }; let changed = false;
    for (const id of s.items || []) {
      const it = byId[id]; if (!it || it.rolling || it.opens || !it.due) continue;
      const days = Math.ceil((new Date(it.due) - Date.now()) / 864e5);
      if (days !== 7 && days !== 1) continue;
      const key = `${id}:${days}`; if (marks[key]) continue;
      const m = (MSG[s.lang] || MSG.en)(days, it.title);
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ ...m, url: `/#sprint`, tag: key }), { TTL: 86400 });
        marks[key] = true; changed = true; sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { await sb(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {}); removed++; break; }
      }
    }
    if (changed) await sb(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "PATCH", prefer: "return=minimal", body: { sent: marks } }).catch(() => {});
  }
  return res.status(200).json({ ok: true, subs: subs.length, sent, removed });
}
