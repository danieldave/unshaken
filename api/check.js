// POST /api/check  { text, image?, lang? }  →  verdict + how many others checked the same message
import { readBody, limited, clip, hasAi, hasDb, aiJson, ruleCheck, sb, sha256, normalise, redact } from "./_lib.js";

const MAX_IMAGE = 2_000_000;
const SYSTEM = `You protect ordinary people from online money scams.
Assess the offer the user received. Reply with JSON only, exactly:
{"verdict":"green"|"orange"|"red","summary":"one plain sentence","flags":["short warning sign"],"next":["short action"]}
- red: any fee/deposit/"update"/"upgrade" to unlock earnings, pay-to-join, recruitment-based pay, impersonating a known brand, requests for OTPs, PINs, BVN or logins.
- orange: unverifiable, crypto-only payouts, chat "agents", odd eligibility, guaranteed daily income.
- green: only when it clearly matches a known legitimate programme with an official website and no fees.
- Never tell the person to pay anything. Never claim certainty you don't have.
- At most 5 flags and 3 actions, in plain English a secondary-school leaver understands.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (limited(req, "check", 6)) return res.status(429).json({ error: "Too many checks. Try again in a minute." });

  const body = readBody(req);
  const text = clip(body.text, 4000);
  const image = typeof body.image === "string" && body.image.startsWith("data:image/") && body.image.length <= MAX_IMAGE ? body.image : null;
  if (!text && !image) return res.status(400).json({ error: "Nothing to check" });

  let result = ruleCheck(text), source = "rules";
  if (hasAi()) {
    try {
      const content = [{ type: "text", text: `OFFER:\n${text || "(see screenshot)"}` }];
      if (image) content.push({ type: "image_url", image_url: { url: image } });
      const out = await aiJson(SYSTEM, content, 500);
      if (["green", "orange", "red"].includes(out.verdict)) {
        result = {
          verdict: out.verdict,
          summary: clip(out.summary, 300) || result.summary,
          flags: (Array.isArray(out.flags) ? out.flags : []).slice(0, 5).map(s => clip(s, 160)),
          next: (Array.isArray(out.next) ? out.next : []).slice(0, 3).map(s => clip(s, 160))
        };
        source = "ai";
      }
    } catch { /* fall back to rules */ }
  }

  // Scam Radar: store an anonymised trace and count how many others checked the same message
  let seen = 0;
  if (hasDb() && text) {
    const hash = sha256(normalise(text));
    try {
      const prev = await sb(`radar_checks?select=id&text_hash=eq.${hash}&created_at=gte.${new Date(Date.now() - 30 * 864e5).toISOString()}`, { headers: { Prefer: "count=exact", Range: "0-0" } });
      seen = prev.count;
      await sb("radar_checks", { method: "POST", prefer: "return=minimal", body: {
        text_hash: hash, snippet: clip(redact(text), 280), verdict: result.verdict, flags: result.flags, source, lang: clip(body.lang, 8) || null
      }});
    } catch { /* radar is best effort */ }
  }

  return res.status(200).json({ ...result, source, seen });
}
