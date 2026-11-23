// POST /api/coach  { sop, target, lang? }  →  scores + fixes for a statement of purpose / personal essay
import { readBody, limited, clip, hasAi, aiJson } from "./_lib.js";

const SYSTEM = `You are a strict, kind scholarship selection coach who has sat on panels for programmes like Chevening, Gates Cambridge, Erasmus Mundus and the Swedish Institute.
Score the applicant's statement against what panels look for. Reply with JSON only:
{"overall":0-100,
 "scores":[{"name":"Clear goal","score":0-10,"note":"..."},{"name":"Evidence & results","score":0-10,"note":"..."},{"name":"Fit with this programme","score":0-10,"note":"..."},{"name":"Leadership & impact","score":0-10,"note":"..."},{"name":"Plan after study","score":0-10,"note":"..."},{"name":"Structure & language","score":0-10,"note":"..."}],
 "top_fixes":["most important change first", "...max 5"],
 "rewrites":[{"before":"exact sentence from the text","after":"stronger version keeping the same facts"}],
 "keep":["what already works, max 3"]}
Rules: never invent achievements, numbers or facts the applicant did not write; when evidence is missing, say what kind of evidence to add. Max 4 rewrites. Notes under 25 words. Plain English.
Write all notes, fixes and keeps in the language code given as LANG (en, pcm=Nigerian Pidgin, fr, yo, ha, ig, sw). Keep rewrites in the essay's own language.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!hasAi()) return res.status(503).json({ error: "Coach not configured" });
  if (limited(req, "coach", 3)) return res.status(429).json({ error: "Give it a minute and try again." });
  const body = readBody(req);
  const sop = clip(body.sop, 9000), target = clip(body.target, 160) || "a funded scholarship", lang = clip(body.lang, 4) || "en";
  if (sop.length < 300) return res.status(400).json({ error: "Paste at least a few paragraphs (300+ characters)." });
  try {
    const out = await aiJson(SYSTEM, `LANG: ${lang}\nTARGET: ${target}\n\nSTATEMENT:\n${sop}`, 1400);
    return res.status(200).json(out);
  } catch {
    return res.status(502).json({ error: "Coach is busy. Try again shortly." });
  }
}
