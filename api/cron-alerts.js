// The daily job (vercel.json "crons", 07:00 UTC = 8am West Africa). Vercel calls it with "Authorization: Bearer <CRON_SECRET>".
// Each step runs on its own, so one failure never blocks the others:
//   1. expire   – listings whose deadline passed → status "expired" (never shown publicly again)
//   2. digest   – posts the daily digest (approved in the last 24h + closing soon + rates) to Telegram, once per day
//   3. alerts   – push notifications 7 days and 1 day before saved deadlines
//   4. drafts   – pulls official sources (config/sources.json) into status "draft" for the owner to review. Never approves.
// Run one step by hand: /api/cron-alerts?task=drafts (or expire, digest, alerts) with the same header.
import webpush from "web-push";
import { hasDb, sb } from "./_lib.js";
import { expirePast, generateDrafts, digestData, buildDigest, postTelegram, hasTelegram, approvedRows, toPublic, siteUrl, DIGEST_LANGS } from "./_queue.js";

const MSG = {
  en: (d, title) => ({ title: d === 1 ? "Closes tomorrow" : "One week left", body: `${title}: ${d === 1 ? "last day to finish your application." : "7 days to the deadline. Open your sprint."}` }),
  pcm: (d, title) => ({ title: d === 1 ? "E go close tomorrow" : "One week remain", body: `${title}: ${d === 1 ? "na last day to finish your application o." : "7 days remain. Open your sprint."}` }),
  fr: (d, title) => ({ title: d === 1 ? "Ferme demain" : "Plus qu'une semaine", body: `${title} : ${d === 1 ? "dernier jour pour finaliser votre candidature." : "7 jours avant la date limite. Ouvrez votre sprint."}` })
};

async function alerts(site) {
  if (!hasDb() || !process.env.VAPID_PRIVATE_KEY) return { skipped: "not configured" };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const data = await fetch(`${site}/data/listings.json`).then(r => r.json());
  const byId = Object.fromEntries(data.items.map(i => [i.id, i]));
  try { for (const r of await approvedRows()) byId[r.id] ??= toPublic(r); } catch {}
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
  return { subs: subs.length, sent, removed };
}

async function digest(site) {
  if (!hasTelegram()) return { skipped: "telegram not configured" };
  const day = new Date().toISOString().slice(0, 10);
  if (hasDb()) { const { data } = await sb(`digest_log?select=day&day=eq.${day}`); if (data?.length) return { skipped: "already posted today" }; }
  const lang = DIGEST_LANGS.includes(process.env.DIGEST_LANG) ? process.env.DIGEST_LANG : "en";
  const d = await digestData({ site });
  const messages = await postTelegram(buildDigest({ ...d, site, lang }));
  if (hasDb()) await sb("digest_log?on_conflict=day", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { day, channel: "telegram", items: d.fresh.length } }).catch(() => {});
  return { messages, fresh: d.fresh.length };
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: "Not allowed" });
  const site = siteUrl(process.env.SITE_URL ? null : req);
  const want = String(req.query?.task || "all");
  const steps = { expire: () => hasDb() ? expirePast().then(n => ({ expired: n })) : { skipped: "no database" }, digest: () => digest(site), alerts: () => alerts(site), drafts: () => hasDb() ? generateDrafts() : { skipped: "no database" } };
  const out = {};
  for (const [name, run] of Object.entries(steps)) {
    if (want !== "all" && want !== name) continue;
    try { out[name] = await run(); } catch (e) { out[name] = { error: String(e.message || e).slice(0, 120) }; }
  }
  return res.status(200).json({ ok: true, ...out });
}
