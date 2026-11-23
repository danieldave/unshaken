// POST /api/translate  { lang, items:[{id, title, get, who, steps:[], dueText}] }
// Translates listing text once per language and caches it in the database.
import { readBody, limited, clip, hasAi, hasDb, aiJson, sb, sha256 } from "./_lib.js";

const LANGS = { pcm: "Nigerian Pidgin", fr: "French", yo: "Yoruba", ha: "Hausa", ig: "Igbo", sw: "Swahili" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = readBody(req);
  const lang = String(body.lang || "");
  if (!LANGS[lang]) return res.status(400).json({ error: "Unsupported language" });
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map(it => ({
    id: clip(it.id, 40), title: clip(it.title, 160), get: clip(it.get, 400), who: clip(it.who, 400),
    dueText: clip(it.dueText, 80), steps: (Array.isArray(it.steps) ? it.steps : []).slice(0, 8).map(s => clip(s, 200))
  }));
  const keyOf = it => it.id + ":" + sha256(JSON.stringify(it)).slice(0, 16);
  const out = {};

  // 1. cached
  if (hasDb() && items.length) {
    try {
      const keys = items.map(keyOf).map(k => `"${k}"`).join(",");
      const { data } = await sb(`translations?select=key,body&lang=eq.${lang}&key=in.(${encodeURIComponent(keys)})`);
      for (const row of data) out[row.key.split(":")[0]] = row.body;
    } catch {}
  }
  const missing = items.filter(it => !out[it.id]);
  if (!missing.length) return res.status(200).json({ lang, items: out });
  if (!hasAi()) return res.status(200).json({ lang, items: out, partial: true });
  if (limited(req, "translate", 4)) return res.status(200).json({ lang, items: out, partial: true });

  // 2. translate the rest in one call
  try {
    const sys = `Translate these opportunity listings into ${LANGS[lang]}. Keep programme names, organisation names, currencies, numbers, dates and URLs exactly as they are. Keep meaning precise; simple everyday wording. Reply with JSON only: {"items":{"<id>":{"title":"","get":"","who":"","dueText":"","steps":[""]}}}`;
    const t = await aiJson(sys, JSON.stringify(missing), 3500);
    for (const it of missing) {
      const tr = t.items?.[it.id];
      if (!tr || typeof tr !== "object") continue;
      const clean = { title: clip(tr.title, 200) || it.title, get: clip(tr.get, 500) || it.get, who: clip(tr.who, 500) || it.who,
        dueText: clip(tr.dueText, 100) || it.dueText, steps: Array.isArray(tr.steps) && tr.steps.length === it.steps.length ? tr.steps.map(s => clip(s, 240)) : it.steps };
      out[it.id] = clean;
      if (hasDb()) sb("translations", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key: keyOf(it), lang, body: clean } }).catch(() => {});
    }
  } catch {}
  return res.status(200).json({ lang, items: out });
}
