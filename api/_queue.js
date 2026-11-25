// Listings queue, draft generator, exchange rates, daily digest and Telegram posting.
// Not a route (files starting with "_" are private on Vercel). Used by admin.js, listings.js and cron-alerts.js.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { hasDb, hasAi, sb, aiJson, clip } from "./_lib.js";

const sha = s => createHash("sha256").update(s).digest("hex");
export const CATS = ["Go", "Earn", "Learn", "Grow"];
export const STATUSES = ["draft", "approved", "rejected", "expired"];
export const ID_RE = /^[a-z0-9][a-z0-9-]{2,79}$/;
const UA = "Mozilla/5.0 (compatible; UnshakenBot/1.0; official-sources-only)";

/* ---------- URLs ---------- */
const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$|_hs)/i;
/** Normalised form of a link, used to dedupe: no scheme, no www, no tracking params, no hash, no trailing slash. */
export function normUrl(u) {
  let x; try { x = new URL(String(u).trim()); } catch { return null; }
  if (!/^https?:$/.test(x.protocol)) return null;
  const params = [...x.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const q = params.length ? "?" + new URLSearchParams(params).toString() : "";
  const path = x.pathname.replace(/\/+$/, "") || "";
  return (x.hostname.toLowerCase().replace(/^www\./, "") + path + q).slice(0, 600);
}
export const isHttps = u => { try { return new URL(u).protocol === "https:"; } catch { return false; } };
export function slugFor(title, link) {
  const base = String(title || "listing").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 48).replace(/-$/, "");
  return `${base || "listing"}-${sha(normUrl(link) || String(link)).slice(0, 6)}`;
}

/* ---------- rows ---------- */
/** A DB row in the exact shape the public app already uses for listings.json items. */
export function toPublic(r) {
  const o = { id: r.id, cat: r.cat, title: r.title, get: r.get || "", who: r.who || "", steps: Array.isArray(r.steps) ? r.steps : [], link: r.link, elig: r.elig || {}, tags: r.tags || [], src: "live" };
  if (r.rolling) o.rolling = true; else { o.due = r.due; o.dueText = r.due_text || ""; }
  if (r.opens) o.opens = true;
  if (r.amount) o.amount = r.amount;
  if (r.flag) o.flag = r.flag;
  if (r.verified_on) o.verified = r.verified_on;
  return o;
}

/** Whitelist and clean fields the owner can edit. Unknown keys are ignored. */
export function cleanFields(f = {}) {
  const out = {};
  const str = (k, n) => { if (f[k] !== undefined) out[k] = f[k] === null ? null : clip(f[k], n); };
  str("title", 200); str("get", 1200); str("who", 1200); str("due_text", 120); str("flag", 400); str("notes", 2000);
  if (f.cat !== undefined && CATS.includes(f.cat)) out.cat = f.cat;
  if (f.link !== undefined) { const l = clip(f.link, 600); out.link = l; const n = normUrl(l); if (n) out.link_norm = n; }
  if (f.source_url !== undefined) out.source_url = clip(f.source_url, 600);
  if (f.steps !== undefined) {
    const arr = Array.isArray(f.steps) ? f.steps : String(f.steps).split(/\n+/);
    out.steps = arr.map(s => clip(String(s).replace(/^\s*(\d+[.)]|[-•*])\s*/, ""), 300)).filter(Boolean).slice(0, 12);
  }
  if (f.tags !== undefined) {
    const arr = Array.isArray(f.tags) ? f.tags : String(f.tags).split(",");
    out.tags = [...new Set(arr.map(t => clip(String(t).toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-"), 40)).filter(Boolean))].slice(0, 12);
  }
  for (const k of ["rolling", "opens"]) if (f[k] !== undefined) out[k] = Boolean(f[k]);
  if (f.due !== undefined) {
    if (!f.due) out.due = null;
    else { const d = new Date(f.due); if (!isNaN(d)) out.due = d.toISOString(); }
  }
  if (f.elig !== undefined) {
    let e = f.elig; if (typeof e === "string") { try { e = e.trim() ? JSON.parse(e) : {}; } catch { e = undefined; } }
    if (e && typeof e === "object" && !Array.isArray(e)) out.elig = e;
  }
  if (f.amount !== undefined) {
    let a = f.amount; if (typeof a === "string") { try { a = a.trim() ? JSON.parse(a) : null; } catch { a = undefined; } }
    if (a === null || (a && typeof a === "object" && a.cur && Number(a.value))) out.amount = a;
  }
  if (f.verified_on !== undefined) out.verified_on = /^\d{4}-\d{2}-\d{2}$/.test(String(f.verified_on)) ? f.verified_on : null;
  return out;
}

/** Why a row can't go live yet (empty array = OK to approve). Codes are translated in the admin page. */
export function problems(r, now = Date.now()) {
  const p = [];
  if (!r.title || r.title.length < 3) p.push("title");
  if (!isHttps(r.link)) p.push("link");
  if (!r.get) p.push("get");
  if (!r.who) p.push("who");
  if (!Array.isArray(r.steps) || !r.steps.length) p.push("steps");
  if (!CATS.includes(r.cat)) p.push("cat");
  if (!r.rolling) {
    if (!r.due) p.push("due");
    else if (!r.opens && new Date(r.due).getTime() < now) p.push("past");
  }
  if (!r.source_url) p.push("source");
  return p;
}

/* ---------- DB helpers ---------- */
export async function approvedRows() {
  const { data } = await sb("listings?select=*&status=eq.approved&order=due.asc.nullslast&limit=500");
  const now = Date.now();
  return (data || []).filter(r => r.rolling || r.opens || (r.due && new Date(r.due).getTime() > now));
}
/** Mark drafts/approved listings whose deadline has passed as expired. Returns how many changed. */
export async function expirePast(nowIso = new Date().toISOString()) {
  const { data } = await sb(`listings?status=in.(draft,approved)&rolling=eq.false&opens=eq.false&due=lt.${encodeURIComponent(nowIso)}&select=id`, {
    method: "PATCH", prefer: "return=representation", body: { status: "expired", reviewed_at: nowIso, updated_at: nowIso }
  });
  return (data || []).length;
}

/* ---------- fetching ---------- */
async function fetchText(url, { fetchImpl = fetch, timeout = 9000, max = 400_000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.text()).slice(0, max);
  } finally { clearTimeout(t); }
}
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
export const decode = s => String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ""), /^#x/i.test(e) ? 16 : 10) || 32) : (ENT[e.toLowerCase()] ?? m));
export const stripTags = html => decode(String(html).replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|li|h\d|div|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

/** Minimal RSS 2.0 / Atom parser (no dependencies). */
export function parseFeed(xml) {
  const blocks = [...String(xml).matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map(m => m[0]);
  const tag = (b, n) => { const m = b.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)<\\/${n}>`, "i")); return m ? decode(m[1]).trim() : ""; };
  return blocks.map(b => {
    let link = tag(b, "link");
    if (!link || /^</.test(link)) { const m = b.match(/<link\b[^>]*?href=["']([^"']+)["'][^>]*?(rel=["']alternate["'])?[^>]*>/i); link = m ? decode(m[1]) : ""; }
    if (!link) link = tag(b, "guid");
    const summary = stripTags(tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content"));
    const date = tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") || tag(b, "dc:date");
    return { title: stripTags(tag(b, "title")), link: link.trim(), summary: summary.slice(0, 1500), date: date ? new Date(date) : null };
  }).filter(i => i.title && /^https?:\/\//.test(i.link));
}

export function loadSources() {
  const tries = [join(process.cwd(), "config", "sources.json"), new URL("../config/sources.json", import.meta.url)];
  for (const p of tries) { try { return JSON.parse(readFileSync(p, "utf8")); } catch {} }
  return { sources: [] };
}

/* ---------- AI drafting ---------- */
const DRAFT_SYSTEM = `You help a free opportunities board for unemployed graduates and curious people worldwide (many in Africa).
You receive the text of ONE official web page. Decide whether it announces a CURRENTLY OPEN, legitimate opportunity: scholarship, fellowship, free course with certificate, paid internship/job programme, remote-earning programme, or grant.
Rules: never invent facts, dates, amounts or links; only use what the page says. If the page asks applicants to pay any fee to apply, to "unlock" earnings, or needs a VPN/location trick, set fee_required true. If it is a news story, a closed call, a past event, or vague, set is_opportunity false.
Return JSON: {"is_opportunity":bool,"reason":"short","fee_required":bool,"scam_signals":[string],"title":"official name","cat":"Go|Earn|Learn|Grow","get":"what people receive, 1-2 sentences","who":"who can apply, 1-2 sentences","steps":["3-6 short imperative steps"],"deadline_iso":"YYYY-MM-DDTHH:MM:SSZ or null","deadline_text":"as written, with time zone","rolling":bool,"official_link":"the best apply/info URL that appears on the page, or empty","tags":["3-6 lowercase tags"],"levels":["bachelor|master|phd"],"flag":"anything the owner must confirm, or empty"}
Category guide: Go = study/fellowship abroad, Earn = paid work/internship, Learn = free course/certificate, Grow = grants, leadership, volunteering.`;

const PAGE_SYSTEM = `You read ONE official web page of a university, government, foundation or international organisation.
List up to 3 opportunities on it that are CURRENTLY OPEN for applications (scholarships, fellowships, paid internships, free certified courses, grants). Ignore closed calls and news.
Only use links that literally appear in the page's link list. Never invent anything.
Return JSON: {"items":[{"title":"...","link":"exact URL from the link list","why":"one line"}]}`;

function pageLinks(html, base) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try { const u = new URL(decode(m[1]), base).toString(); if (/^https?:/.test(u)) out.push([u, stripTags(m[2]).slice(0, 80)]); } catch {}
  }
  return out;
}
const linkOnPage = (link, html, base) => { const n = normUrl(link); return n && pageLinks(html, base).some(([u]) => normUrl(u) === n); };

async function aiDraft(cand, fetchImpl) {
  let html = "";
  try { html = await fetchText(cand.link, { fetchImpl }); } catch { /* fall back to the feed summary */ }
  const text = html ? stripTags(html).slice(0, 12000) : cand.summary;
  const j = await aiJson(DRAFT_SYSTEM, `URL: ${cand.link}\nFEED TITLE: ${cand.title}\nFEED SUMMARY: ${cand.summary}\n\nPAGE TEXT:\n${text}`, 900);
  if (!j || !j.is_opportunity) return { skip: "not_opportunity" };
  if (j.fee_required || (Array.isArray(j.scam_signals) && j.scam_signals.length)) return { skip: "fee_or_scam" };
  let link = cand.link;
  if (j.official_link && isHttps(j.official_link) && (normUrl(j.official_link) === normUrl(cand.link) || (html && linkOnPage(j.official_link, html, cand.link)))) link = j.official_link;
  const due = j.deadline_iso && !isNaN(new Date(j.deadline_iso)) ? new Date(j.deadline_iso).toISOString() : null;
  const elig = Array.isArray(j.levels) && j.levels.length ? { levels: j.levels.filter(l => ["bachelor", "master", "phd"].includes(l)) } : {};
  return {
    row: {
      ...cleanFields({ title: j.title || cand.title, cat: CATS.includes(j.cat) ? j.cat : cand.cat, get: j.get, who: j.who, steps: j.steps || [], link, due, due_text: j.deadline_text || "", rolling: Boolean(j.rolling) && !due, tags: j.tags || [], elig, flag: [j.flag, "AI draft: check every detail on the official page before approving."].filter(Boolean).join(" ") }),
      origin: "ai"
    }
  };
}
function rawDraft(cand) {
  return {
    ...cleanFields({ title: cand.title, cat: cand.cat, get: cand.summary.slice(0, 400), who: "", steps: [], link: cand.link, due: null, due_text: "", flag: "Raw feed item (no AI): add who can apply, the deadline and the steps from the official page before approving." }),
    origin: "rss"
  };
}

/**
 * Pull candidate opportunities from config/sources.json and save NEW ones as drafts.
 * Never approves anything. Dedupes by normalised URL (against the DB and within the run).
 */
export async function generateDrafts({ fetchImpl = fetch, now = new Date(), max } = {}) {
  const cfg = loadSources(), ai = hasAi();
  const limit = Math.max(0, Number(max ?? process.env.DRAFTS_PER_RUN ?? cfg.maxDraftsPerRun ?? 8));
  const report = { ai, sources: 0, candidates: 0, created: 0, dupes: 0, skipped: { not_opportunity: 0, fee_or_scam: 0, old: 0, filtered: 0, page_needs_ai: 0 }, errors: [] };
  const cands = [];
  for (const src of cfg.sources || []) {
    if (src.enabled === false) continue;
    report.sources++;
    try {
      if (src.type === "rss") {
        const items = parseFeed(await fetchText(src.url, { fetchImpl }));
        const kw = (src.keywords || []).map(k => k.toLowerCase());
        for (const it of items.slice(0, 40)) {
          if (src.maxAgeDays && it.date && !isNaN(it.date) && now - it.date > src.maxAgeDays * 864e5) { report.skipped.old++; continue; }
          const hay = (it.title + " " + it.summary).toLowerCase();
          if (kw.length && !kw.some(k => hay.includes(k))) { report.skipped.filtered++; continue; }
          cands.push({ ...it, cat: src.cat || "Learn", source_url: it.link, source: src.id });
        }
      } else if (src.type === "page") {
        if (!ai) { report.skipped.page_needs_ai++; continue; }
        const html = await fetchText(src.url, { fetchImpl });
        const links = pageLinks(html, src.url).slice(0, 250).map(([u, t]) => `${t} -> ${u}`).join("\n");
        const j = await aiJson(PAGE_SYSTEM, `PAGE: ${src.url}\n\nTEXT:\n${stripTags(html).slice(0, 9000)}\n\nLINKS:\n${links}`, 500);
        for (const it of (j.items || []).slice(0, 3)) {
          if (!it.link || !linkOnPage(it.link, html, src.url)) continue;
          cands.push({ title: clip(it.title, 200), link: new URL(it.link, src.url).toString(), summary: clip(it.why, 400), cat: src.cat || "Go", source_url: src.url, source: src.id });
        }
      }
    } catch (e) { report.errors.push(`${src.id}: ${String(e.message || e).slice(0, 80)}`); }
  }
  // dedupe within this run
  const seen = new Set(), uniq = [];
  for (const c of cands) { const n = normUrl(c.link); if (!n || seen.has(n)) { report.dupes++; continue; } seen.add(n); uniq.push({ ...c, norm: n }); }
  report.candidates = uniq.length;
  // dedupe against the DB (any status, so rejected items never come back)
  const existing = new Set();
  for (let i = 0; i < uniq.length; i += 40) {
    const chunk = uniq.slice(i, i + 40).map(c => `"${c.norm.replace(/["\\]/g, "")}"`).join(",");
    const { data } = await sb(`listings?select=link_norm&link_norm=in.(${encodeURIComponent(chunk)})`);
    for (const r of data || []) existing.add(r.link_norm);
  }
  const fresh = uniq.filter(c => { if (existing.has(c.norm)) { report.dupes++; return false; } return true; }).slice(0, limit);

  const rows = [];
  const work = fresh.map(c => async () => {
    let row;
    if (ai) {
      try { const r = await aiDraft(c, fetchImpl); if (r.skip) { report.skipped[r.skip]++; return; } row = r.row; }
      catch (e) { report.errors.push(`ai: ${String(e.message || e).slice(0, 60)}`); row = rawDraft(c); }
    } else row = rawDraft(c);
    const norm = row.link_norm || c.norm;
    if (existing.has(norm) || rows.some(r => r.link_norm === norm)) { report.dupes++; return; }
    rows.push({ ...row, id: slugFor(row.title, row.link), status: "draft", link_norm: norm, source_url: c.source_url, notes: `Found by the daily generator from source "${c.source}" on ${now.toISOString().slice(0, 10)}.` });
  });
  for (let i = 0; i < work.length; i += 4) await Promise.all(work.slice(i, i + 4).map(f => f())); // 4 at a time
  if (rows.length) {
    const { data } = await sb("listings?on_conflict=link_norm", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: rows });
    report.created = (data || []).length;
  }
  return report;
}

/* ---------- exchange rates (free, no key) ---------- */
export const RATE_CODES = ["NGN", "GHS", "KES", "ZAR", "XOF", "EGP", "UGX", "INR"];
export async function getRates({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl("https://open.er-api.com/v6/latest/USD", { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`rates ${r.status}`);
  const j = await r.json();
  if (j.result !== "success" || !j.rates?.NGN) throw new Error("rates bad");
  const R = j.rates, per = code => ({ USD: R[code], GBP: R[code] / R.GBP, EUR: R[code] / R.EUR });
  return {
    source: "open.er-api.com", attribution: "Rates by Exchange Rate API (https://www.exchangerate-api.com)",
    updated: j.time_last_update_utc ? new Date(j.time_last_update_utc).toISOString() : new Date().toISOString(),
    ngn: per("NGN"), other: Object.fromEntries(RATE_CODES.filter(c => c !== "NGN" && R[c]).map(c => [c, R[c]]))
  };
}

/* ---------- digest ---------- */
const D = {
  en: { head: "Unshaken Daily", tag: "Keep smiling. Here are today's open doors.", rates: "Rates today", rates_note: "mid-market reference rate", fresh: "New today", closing: "Closing soon", open: "Always open", none: "No new doors today. Here's what closes first.", left: "{n} days left", today: "closes today", rolling: "always open", free: "Free to apply. Never pay anyone to \"process\" an application.", more: "All doors, steps and deadlines" },
  pcm: { head: "Unshaken Daily", tag: "Keep smiling. See the doors wey open today.", rates: "Rate today", rates_note: "market reference rate", fresh: "New today", closing: "E don near close", open: "E dey open everytime", none: "No new door today. See the ones wey go close first.", left: "{n} days remain", today: "e go close today", rolling: "e dey open everytime", free: "Na free to apply. No pay anybody make dem \"process\" your application.", more: "All doors, steps and deadlines" },
  fr: { head: "Unshaken Daily", tag: "Gardez le sourire. Voici les portes ouvertes du jour.", rates: "Taux du jour", rates_note: "taux de référence du marché", fresh: "Nouveau aujourd'hui", closing: "Ferme bientôt", open: "Toujours ouvert", none: "Pas de nouveauté aujourd'hui. Voici ce qui ferme en premier.", left: "{n} jours restants", today: "ferme aujourd'hui", rolling: "toujours ouvert", free: "Candidature gratuite. Ne payez jamais pour « traiter » un dossier.", more: "Toutes les portes, étapes et dates limites" },
  yo: { head: "Unshaken Daily", tag: "Máa rẹ́rìn-ín. Àwọn ilẹ̀kùn tó ṣí lónìí nìyí.", rates: "Iye owó lónìí", rates_note: "iye ìtọ́kasí ọjà", fresh: "Tuntun lónìí", closing: "Yóò tì láìpẹ́", open: "Ó ṣí nígbà gbogbo", none: "Kò sí tuntun lónìí. Èyí tó máa tì kọ́kọ́ nìyí.", left: "Ọjọ́ {n} ló kù", today: "yóò tì lónìí", rolling: "ó ṣí nígbà gbogbo", free: "Ọ̀fẹ́ ni láti béèrè. Má ṣe sanwó fún ẹnikẹ́ni láti \"ṣe\" ìbéèrè rẹ.", more: "Gbogbo ilẹ̀kùn, ìgbésẹ̀ àti ọjọ́ ìparí" },
  ha: { head: "Unshaken Daily", tag: "Ci gaba da murmushi. Ga ƙofofin da ke buɗe yau.", rates: "Farashin yau", rates_note: "farashin kasuwa na nuni", fresh: "Sabo yau", closing: "Za a rufe nan ba da jimawa ba", open: "A buɗe koyaushe", none: "Babu sabo yau. Ga waɗanda za a fara rufewa.", left: "Saura kwana {n}", today: "za a rufe yau", rolling: "a buɗe koyaushe", free: "Neman kyauta ne. Kada ka biya kowa don \"sarrafa\" neman ka.", more: "Duk ƙofofi, matakai da wa'adi" },
  ig: { head: "Unshaken Daily", tag: "Na-amụmụ ọnụ ọchị. Lee ọnụ ụzọ ndị meghere taa.", rates: "Ọnụego taa", rates_note: "ọnụego ntụaka ahịa", fresh: "Ọhụrụ taa", closing: "Ọ ga-emechi n'oge na-adịghị anya", open: "Ọ na-emeghe mgbe niile", none: "Enweghị ọhụrụ taa. Lee ndị ga-ebu ụzọ mechie.", left: "Ụbọchị {n} fọdụrụ", today: "ọ ga-emechi taa", rolling: "ọ na-emeghe mgbe niile", free: "Ịtinye akwụkwọ bụ n'efu. Akwụla onye ọ bụla ka ọ \"hazie\" akwụkwọ gị.", more: "Ọnụ ụzọ niile, usoro na oge njedebe" },
  sw: { head: "Unshaken Daily", tag: "Endelea kutabasamu. Hii ndiyo milango iliyo wazi leo.", rates: "Viwango vya leo", rates_note: "kiwango cha rejea cha soko", fresh: "Mpya leo", closing: "Inafungwa karibuni", open: "Iko wazi kila wakati", none: "Hakuna mpya leo. Hii ndiyo itakayofungwa kwanza.", left: "Siku {n} zimebaki", today: "inafungwa leo", rolling: "iko wazi kila wakati", free: "Kuomba ni bure. Usimlipe mtu yeyote \"kushughulikia\" maombi yako.", more: "Milango yote, hatua na tarehe za mwisho" }
};
export const DIGEST_LANGS = Object.keys(D);
const fmt = (n, d = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const daysLeft = (iso, now) => Math.ceil((new Date(iso) - now) / 864e5);

/**
 * Build the WhatsApp/Telegram text. *bold* is WhatsApp formatting (converted to HTML for Telegram).
 * fresh = listings approved in the last 24h; all = every live listing (database + listings.json) for "closing soon".
 */
export function buildDigest({ fresh = [], all = [], rates = null, site = "", lang = "en", now = new Date() }) {
  const t = D[lang] || D.en, L = [];
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  L.push(`🌅 *${t.head}* · ${dateStr}`, t.tag, "");
  if (rates?.ngn) {
    L.push(`💱 *${t.rates}* (${t.rates_note})`);
    L.push(`$1 = ₦${fmt(rates.ngn.USD)} · £1 = ₦${fmt(rates.ngn.GBP)} · €1 = ₦${fmt(rates.ngn.EUR)}`);
    const o = rates.other || {}, bits = [["GHS", "GH₵"], ["KES", "KSh "], ["ZAR", "R"], ["XOF", "CFA "], ["EGP", "E£"]].filter(([c]) => o[c]).map(([c, s]) => `${s}${fmt(o[c], c === "XOF" || c === "UGX" ? 0 : 2)}`);
    if (bits.length) L.push(`$1 = ${bits.join(" · ")}`);
    L.push("");
  }
  const line = (it, i) => {
    const d = it.rolling ? t.rolling : it.opens ? (it.dueText || "") : (n => n <= 0 ? t.today : t.left.replace("{n}", n))(daysLeft(it.due, now));
    const out = [`${i + 1}. *${it.title}*`];
    if (it.get) out.push(`   🎁 ${clip(it.get, 160)}`);
    out.push(`   ⏳ ${[it.dueText, d].filter(Boolean).join(" · ")}`);
    out.push(`   🔗 ${it.link}`);
    return out.join("\n");
  };
  const live = all.filter(i => i.rolling || i.opens || (i.due && new Date(i.due) > now));
  const freshIds = new Set(fresh.map(i => i.id));
  if (fresh.length) { L.push(`🆕 *${t.fresh}*`); fresh.slice(0, 8).forEach((it, i) => L.push(line(it, i))); L.push(""); }
  else L.push(t.none, "");
  const closing = live.filter(i => !i.rolling && !i.opens && !freshIds.has(i.id)).sort((a, b) => new Date(a.due) - new Date(b.due)).filter(i => daysLeft(i.due, now) <= 14).slice(0, 4);
  if (closing.length) { L.push(`⏰ *${t.closing}*`); closing.forEach((it, i) => L.push(line(it, i))); L.push(""); }
  const always = live.filter(i => i.rolling && !freshIds.has(i.id));
  if (always.length) { const pick = always[Math.floor(now.getTime() / 864e5) % always.length]; L.push(`📚 *${t.open}*`, line(pick, 0), ""); }
  L.push(`✅ ${t.free}`);
  if (site) L.push(`👉 ${t.more}: ${site}`);
  if (rates?.attribution) L.push(`_${rates.attribution.replace(/_/g, "")}_`);
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** WhatsApp-style text → Telegram HTML. */
export function toTelegramHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1<i>$2</i>");
}
/** Split into Telegram-sized messages (limit 4096) on blank lines. */
export function chunks(text, max = 3800) {
  const parts = String(text).split("\n\n"), out = []; let cur = "";
  for (const p of parts) { if ((cur + "\n\n" + p).length > max && cur) { out.push(cur); cur = p; } else cur = cur ? cur + "\n\n" + p : p; }
  if (cur) out.push(cur);
  return out.flatMap(c => c.length > max ? c.match(new RegExp(`[\\s\\S]{1,${max}}`, "g")) : [c]);
}
export const hasTelegram = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID);
export async function postTelegram(text, { fetchImpl = fetch } = {}) {
  if (!hasTelegram()) throw new Error("telegram not configured");
  let sent = 0;
  for (const c of chunks(text)) {
    const r = await fetchImpl(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHANNEL_ID, text: toTelegramHtml(c), parse_mode: "HTML", disable_web_page_preview: true })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(`telegram ${r.status}${j.description ? ": " + String(j.description).slice(0, 80) : ""}`);
    sent++;
  }
  return sent;
}

/** Everything a digest needs: fresh DB listings, all live listings (DB + listings.json), rates. */
export async function digestData({ site, fetchImpl = fetch, now = new Date() }) {
  let staticData = null, dbRows = [], rates = null;
  try { staticData = await fetchImpl(`${site}/data/listings.json`).then(r => r.ok ? r.json() : null); } catch {}
  if (hasDb()) { try { dbRows = await approvedRows(); } catch {} }
  try { rates = await getRates({ fetchImpl }); } catch {
    const s = staticData?.rates; // fall back to the owner's official rates in listings.json
    if (s?.usd) rates = { source: s.usd.source, updated: s.usd.date, ngn: { USD: s.usd.ngn, GBP: s.gbp?.ngn, EUR: s.eur?.ngn }, other: {} };
  }
  const pub = dbRows.map(toPublic), ids = new Set(pub.map(i => i.id));
  const all = [...pub, ...((staticData?.items) || []).filter(i => !ids.has(i.id))];
  const fresh = dbRows.filter(r => r.approved_at && now - new Date(r.approved_at) < 864e5).map(toPublic);
  return { fresh, all, rates };
}
export const siteUrl = req => (process.env.SITE_URL || (req?.headers?.host ? `https://${req.headers.host}` : `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "localhost"}`)).replace(/\/+$/, "");
