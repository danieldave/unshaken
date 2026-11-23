// Shared server helpers. Files starting with "_" are not exposed as routes by Vercel.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
export const hasDb = () => Boolean(SB_URL() && SB_KEY());
export const hasAi = () => Boolean(process.env.OPENAI_API_KEY);

/* ---------- request helpers ---------- */
export function readBody(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  return b && typeof b === "object" ? b : {};
}
export const ipOf = req => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
export const clip = (s, n) => String(s ?? "").trim().slice(0, n);

const buckets = new Map();
/** Best-effort in-memory limit per IP per route. */
export function limited(req, route, max, windowMs = 60_000) {
  const key = route + ":" + ipOf(req), now = Date.now();
  const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
  list.push(now); buckets.set(key, list);
  return list.length > max;
}
export function isAdmin(req) {
  const want = process.env.ADMIN_TOKEN || "", got = String(req.headers["x-admin-token"] || "");
  if (want.length < 16 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}
export const sha256 = s => createHash("sha256").update(s).digest("hex");
export const code = (n = 6) => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const b = randomBytes(n);
  return Array.from(b, x => abc[x % abc.length]).join("");
};
export const secret = () => randomBytes(18).toString("base64url");

/** Remove phone numbers, emails, links and wallet addresses before anything is stored. */
export function redact(t) {
  return String(t)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "[link]")
    .replace(/\b(T[1-9A-HJ-NP-Za-km-z]{25,40}|0x[a-fA-F0-9]{40}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39})\b/g, "[wallet]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
}
export const normalise = t => redact(t).toLowerCase().replace(/\s+/g, " ").trim();

/* ---------- Supabase REST (no SDK needed) ---------- */
function sbHeaders(extra = {}) {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json", ...extra };
}
export async function sb(path, { method = "GET", body, prefer, headers } = {}) {
  const r = await fetch(`${SB_URL()}/rest/v1/${path}`, {
    method, headers: sbHeaders({ ...(prefer ? { Prefer: prefer } : {}), ...headers }),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`db ${r.status}`);
  const txt = await r.text();
  return { data: txt ? JSON.parse(txt) : null, count: Number((r.headers.get("content-range") || "").split("/")[1]) || 0 };
}
export async function sbUpload(bucket, path, buffer, contentType) {
  const r = await fetch(`${SB_URL()}/storage/v1/object/${bucket}/${path}`, {
    method: "POST", headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": contentType, "x-upsert": "false" }, body: buffer
  });
  if (!r.ok) throw new Error(`upload ${r.status}`);
}
export async function sbSignedUrl(bucket, path, seconds = 600) {
  const r = await fetch(`${SB_URL()}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST", headers: sbHeaders(), body: JSON.stringify({ expiresIn: seconds })
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.signedURL ? `${SB_URL()}/storage/v1${j.signedURL}` : null;
}

/* ---------- OpenAI ---------- */
export async function aiJson(system, userContent, maxTokens = 700) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2, max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: userContent }]
    })
  });
  if (!r.ok) throw new Error(`ai ${r.status}`);
  const data = await r.json();
  return JSON.parse(data.choices?.[0]?.message?.content || "{}");
}

/* ---------- Rule-based scam check (works with no AI at all) ---------- */
const RULES = [
  [/\b(fee|pay to|registration (fee|money)|activation|processing fee)\b/i, "Asks you to pay before you earn", "red"],
  [/\b(update|upgrade|unlock|recharge|top.?up|deposit)\b/i, "Wants money to 'update', 'upgrade' or unlock withdrawals", "red"],
  [/\b(refer|invite \d+|bring \d+ friends|downline)\b/i, "Earnings depend on recruiting others", "red"],
  [/\b(otp|bvn|pin|password|login details)\b/i, "Asks for codes, PINs or login details", "red"],
  [/\b(usdt|trc20|crypto|bitcoin|btc|wallet address)\b/i, "Pays only in crypto, which is hard to trace or reverse", "orange"],
  [/\b(guaranteed|100%|risk.?free)\b/i, "Promises guaranteed income", "orange"],
  [/\$\s?\d+\s*(daily|a day|per day)|daily (pay|income)/i, "Fixed daily dollar pay for simple tasks", "orange"],
  [/\b(only for (females|ladies|women|girls)|females only)\b/i, "Odd eligibility with no clear reason (could also be unsafe)", "orange"],
  [/\b(agent|dm me|inbox me)\b/i, "Runs through a chat 'agent', not an official site", "orange"],
  [/\b(stream|watch videos|like videos)\b.*\b(earn|\$)/i, "Pays for watching, liking or streaming, a common task-scam hook", "orange"]
];
export function ruleCheck(t) {
  const hits = RULES.filter(([r]) => r.test(t));
  const red = hits.some(h => h[2] === "red");
  const verdict = red || hits.length >= 3 ? "red" : hits.length ? "orange" : "green";
  return {
    verdict,
    summary: { red: "Too many warning signs. Do not pay anything.", orange: "Hold. Some warning signs; verify before you go further.", green: "No common warning signs found in this text. Still check the official site." }[verdict],
    flags: hits.map(h => h[1]).slice(0, 5),
    next: ["Find the company's own website and check the offer is listed there", "Never pay a fee, 'update' or deposit to receive money you earned", "Search the exact name plus the word scam before you sign up"]
  };
}
