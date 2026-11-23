// POST /api/write { type:"referee"|"professor"|"followup", programme, details, name, lang } → { subject, body }
import { readBody, limited, clip, hasAi, aiJson } from "./_lib.js";

const BRIEF = {
  referee: "a polite request asking a former lecturer or manager to write a reference letter, making it easy for them (deadline, what to highlight, offer to send CV and a draft of key points)",
  professor: "a short first email to a potential supervisor/professor showing genuine fit with their research and asking about openings or supervision",
  followup: "a courteous follow-up after no reply for 7–10 days, short, adding one useful detail"
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!hasAi()) return res.status(503).json({ error: "Writer not configured" });
  if (limited(req, "write", 5)) return res.status(429).json({ error: "Give it a minute." });
  const b = readBody(req), type = BRIEF[b.type] ? b.type : "referee";
  const sys = `You write ${BRIEF[type]}. Reply as JSON only: {"subject":"","body":""}. Under 170 words. Warm, specific, respectful, no flattery, no clichés. Use only facts the user gives; where a fact is missing, leave a clear [placeholder]. Write in language code ${clip(b.lang, 4) || "en"} (pcm = Nigerian Pidgin, but keep emails to professors in English).`;
  try {
    const out = await aiJson(sys, `Programme: ${clip(b.programme, 200)}\nSender name: ${clip(b.name, 60) || "[Your name]"}\nRecipient: ${clip(b.to, 80) || "[Name]"}\nDetails from the sender: ${clip(b.details, 1200) || "(none)"}`, 600);
    return res.status(200).json({ subject: clip(out.subject, 160), body: clip(out.body, 2400) });
  } catch { return res.status(502).json({ error: "Writer is busy. Try again." }); }
}
