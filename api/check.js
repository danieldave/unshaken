// Unshaken "Check a deal" API — runs on Vercel as a serverless function.
// The OpenAI key lives ONLY in Vercel's environment variables (OPENAI_API_KEY).
// It is never sent to the browser.

const MAX_TEXT = 4000;            // characters
const MAX_IMAGE = 2_000_000;      // ~1.5 MB file as a base64 data URL
const WINDOW_MS = 60_000;         // rate-limit window
const MAX_PER_WINDOW = 6;         // checks per IP per minute (best effort)
const hits = new Map();

const SYSTEM = `You protect ordinary people from online money scams.
Assess the offer the user received. Reply with JSON only, exactly:
{"verdict":"green"|"orange"|"red","summary":"one plain sentence","flags":["short warning sign"],"next":["short action"]}
Rules:
- red: any fee/deposit/"update"/"upgrade" to unlock earnings, pay-to-join, recruitment-based pay, impersonating a known brand, requests for bank logins or OTPs.
- orange: unverifiable, crypto-only payouts, chat "agents", odd eligibility, guaranteed daily income.
- green: only when it clearly matches a known legitimate programme with an official website and no fees.
- Never tell the person to pay anything. Never claim certainty you don't have.
- At most 5 flags and 3 actions. Plain English a secondary-school leaver understands.`;

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > MAX_PER_WINDOW;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "AI check not configured" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many checks. Try again in a minute." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = String(body?.text || "").slice(0, MAX_TEXT);
  const image = typeof body?.image === "string" && body.image.startsWith("data:image/") && body.image.length <= MAX_IMAGE ? body.image : null;
  if (!text && !image) return res.status(400).json({ error: "Nothing to check" });

  const content = [{ type: "text", text: `OFFER:\n${text || "(see screenshot)"}` }];
  if (image) content.push({ type: "image_url", image_url: { url: image } });

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content }]
      })
    });
    if (!r.ok) return res.status(502).json({ error: "AI service error" });
    const data = await r.json();
    const out = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const verdict = ["green", "orange", "red"].includes(out.verdict) ? out.verdict : "orange";
    return res.status(200).json({
      verdict,
      summary: String(out.summary || "Verify this offer on the official website before going further.").slice(0, 300),
      flags: (Array.isArray(out.flags) ? out.flags : []).slice(0, 5).map(s => String(s).slice(0, 160)),
      next: (Array.isArray(out.next) ? out.next : []).slice(0, 3).map(s => String(s).slice(0, 160))
    });
  } catch {
    return res.status(500).json({ error: "Check failed" });
  }
}
