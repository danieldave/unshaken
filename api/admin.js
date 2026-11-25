// Owner-only. Log in once with the PIN (ADMIN_PIN): POST {action:"login", pin} sets an HttpOnly cookie for 12 hours.
// The legacy header x-admin-token: <ADMIN_TOKEN> still works for scripts.
//
// GET  ?view=session                 → {ok:true} when logged in
// GET  ?view=queue&status=draft      → listings in that status (+ counts); auto-expires past deadlines first
// GET  ?view=digest&lang=en          → today's digest text + whether Telegram is set up
// GET  ?view=proofs | radar | captains (unchanged)
// POST {action:"login"|"logout"}
// POST {action:"listing.update", id, fields}
// POST {action:"listing.approve", ids:[...], fields?}   (fields only with a single id: save edits, then approve)
// POST {action:"listing.reject"|"listing.unpublish", ids:[...]}
// POST {action:"listing.expire"} · {action:"listing.check", id} · {action:"drafts.generate"} · {action:"digest.post"}
// POST {action:"approve"|"reject", id}  → winners' proofs (unchanged)
import { readBody, isAdmin, hasDb, sb, sbSignedUrl, limited, pinMatches, hasPin, newSession, sessionCookie, ipOf } from "./_lib.js";
import { STATUSES, ID_RE, cleanFields, problems, expirePast, generateDrafts, buildDigest, digestData, postTelegram, hasTelegram, siteUrl, isHttps, DIGEST_LANGS } from "./_queue.js";

const fails = new Map(); // ip → [timestamps] of wrong PINs (best effort, per instance)
const tooManyFails = ip => (fails.get(ip) || []).filter(t => Date.now() - t < 15 * 60e3).length >= 8;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (limited(req, "admin", 60)) return res.status(429).json({ error: "Slow down" });
  const b = req.method === "POST" ? readBody(req) : {};

  if (req.method === "POST" && !/application\/json/i.test(String(req.headers["content-type"] || ""))) return res.status(415).json({ error: "JSON only" });
  if (req.method === "POST" && b.action === "login") {
    const ip = ipOf(req);
    if (limited(req, "admin-login", 5) || tooManyFails(ip)) return res.status(429).json({ error: "Too many tries. Wait 15 minutes." });
    if (!hasPin() && !process.env.ADMIN_TOKEN) return res.status(503).json({ error: "Set ADMIN_PIN in Vercel first" });
    if (!pinMatches(b.pin)) {
      fails.set(ip, [...(fails.get(ip) || []), Date.now()]);
      await new Promise(r => setTimeout(r, 400));
      return res.status(200).json({ ok: false, error: "Wrong PIN" }); // 200 so browsers don't log a console error
    }
    fails.delete(ip);
    res.setHeader("Set-Cookie", sessionCookie(newSession()));
    return res.status(200).json({ ok: true });
  }
  if (req.method === "POST" && b.action === "logout") { res.setHeader("Set-Cookie", sessionCookie("", 0)); return res.status(200).json({ ok: true }); }

  if (req.method === "GET" && req.query.view === "session" && !isAdmin(req)) return res.status(200).json({ ok: false });
  if (!isAdmin(req)) return res.status(401).json({ error: "Not allowed" });
  if (req.method === "GET" && req.query.view === "session") return res.status(200).json({ ok: true, db: hasDb(), telegram: hasTelegram() });
  if (!hasDb()) return res.status(503).json({ error: "Database not configured" });

  try {
    if (req.method === "GET") {
      const view = String(req.query.view || "queue");
      if (view === "queue") {
        const status = STATUSES.includes(req.query.status) ? req.query.status : "draft";
        let expired = 0; try { expired = await expirePast(); } catch {}
        const order = status === "approved" ? "due.asc.nullslast" : "created_at.desc";
        const { data } = await sb(`listings?select=*&status=eq.${status}&order=${order}&limit=200`);
        const { data: all } = await sb("listings?select=status&limit=10000");
        const counts = Object.fromEntries(STATUSES.map(s => [s, 0])); for (const r of all || []) counts[r.status]++;
        return res.status(200).json({ items: (data || []).map(r => ({ ...r, problems: problems(r) })), counts, expired });
      }
      if (view === "digest") {
        const lang = DIGEST_LANGS.includes(req.query.lang) ? req.query.lang : "en", site = siteUrl(req);
        const d = await digestData({ site });
        let posted = null; try { const { data } = await sb(`digest_log?select=posted_at,items&day=eq.${new Date().toISOString().slice(0, 10)}`); posted = data?.[0] || null; } catch {}
        return res.status(200).json({ text: buildDigest({ ...d, site, lang }), fresh: d.fresh.length, rates: d.rates, telegram: hasTelegram(), posted });
      }
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
      const now = new Date().toISOString();
      const ids = (Array.isArray(b.ids) ? b.ids : b.id ? [b.id] : []).map(String).filter(i => ID_RE.test(i)).slice(0, 200);
      const inList = `id=in.(${ids.map(encodeURIComponent).join(",")})`;

      if (b.action === "listing.update") {
        if (ids.length !== 1) return res.status(400).json({ error: "Bad id" });
        const f = cleanFields(b.fields);
        if (f.link !== undefined && !isHttps(f.link)) return res.status(400).json({ error: "Link must start with https://" });
        const { data } = await sb(`listings?id=eq.${ids[0]}&select=*`, { method: "PATCH", prefer: "return=representation", body: { ...f, updated_at: now } });
        if (!data?.length) return res.status(404).json({ error: "Not found" });
        return res.status(200).json({ ok: true, item: { ...data[0], problems: problems(data[0]) } });
      }
      if (b.action === "listing.approve") {
        if (!ids.length) return res.status(400).json({ error: "Bad id" });
        if (ids.length === 1 && b.fields) {
          const f = cleanFields(b.fields);
          if (f.link !== undefined && !isHttps(f.link)) return res.status(400).json({ error: "Link must start with https://" });
          await sb(`listings?id=eq.${ids[0]}`, { method: "PATCH", prefer: "return=minimal", body: { ...f, updated_at: now } });
        }
        const { data: rows } = await sb(`listings?${inList}&select=*`);
        const ok = [], blocked = {};
        for (const r of rows || []) { const p = problems(r); if (p.length) blocked[r.id] = p; else ok.push(r.id); }
        if (ok.length) await sb(`listings?id=in.(${ok.map(encodeURIComponent).join(",")})`, { method: "PATCH", prefer: "return=minimal", body: { status: "approved", approved_at: now, reviewed_at: now, updated_at: now } });
        return res.status(200).json({ ok: true, approved: ok, blocked });
      }
      if (b.action === "listing.reject" || b.action === "listing.unpublish") {
        if (!ids.length) return res.status(400).json({ error: "Bad id" });
        const body = b.action === "listing.reject" ? { status: "rejected", reviewed_at: now, updated_at: now } : { status: "draft", approved_at: null, updated_at: now };
        await sb(`listings?${inList}`, { method: "PATCH", prefer: "return=minimal", body });
        return res.status(200).json({ ok: true, ids });
      }
      if (b.action === "listing.expire") return res.status(200).json({ ok: true, expired: await expirePast() });
      if (b.action === "listing.check") {
        if (ids.length !== 1) return res.status(400).json({ error: "Bad id" });
        const { data } = await sb(`listings?id=eq.${ids[0]}&select=link`);
        const link = data?.[0]?.link;
        if (!isHttps(link) || /^https:\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(link)) return res.status(400).json({ error: "Not a public https link" });
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
        try {
          const r = await fetch(link, { redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; UnshakenBot/1.0)" } });
          return res.status(200).json({ ok: r.ok, status: r.status, final: r.url });
        } catch { return res.status(200).json({ ok: false, status: 0 }); } finally { clearTimeout(timer); }
      }
      if (b.action === "drafts.generate") return res.status(200).json({ ok: true, report: await generateDrafts() });
      if (b.action === "digest.post") {
        if (!hasTelegram()) return res.status(400).json({ error: "Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID in Vercel first" });
        const lang = DIGEST_LANGS.includes(b.lang) ? b.lang : (process.env.DIGEST_LANG || "en"), site = siteUrl(req);
        const d = await digestData({ site });
        const sent = await postTelegram(buildDigest({ ...d, site, lang }));
        await sb("digest_log?on_conflict=day", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { day: now.slice(0, 10), posted_at: now, channel: "telegram", items: d.fresh.length } }).catch(() => {});
        return res.status(200).json({ ok: true, messages: sent });
      }
      // Winners' proofs (unchanged behaviour)
      if (["approve", "reject"].includes(b.action) && /^[0-9a-f-]{36}$/.test(String(b.id))) {
        await sb(`proofs?id=eq.${b.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: b.action === "approve" ? "approved" : "rejected", reviewed_at: now } });
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: "Bad request" });
    }
    return res.status(405).json({ error: "GET or POST" });
  } catch (e) {
    return res.status(500).json({ error: "Something failed", detail: String(e.message || "").slice(0, 80) });
  }
}
