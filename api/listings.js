// Public, read-only. Only APPROVED, still-open listings ever leave the database.
// GET /api/listings                 → { items: [...] } in the same shape as data/listings.json items
// GET /api/listings?view=digest&lang=en → { text, date, fresh, rates } for the /digest page and sharing
import { hasDb, limited } from "./_lib.js";
import { approvedRows, toPublic, buildDigest, digestData, siteUrl, DIGEST_LANGS } from "./_queue.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (limited(req, "listings", 120)) return res.status(429).json({ error: "Slow down" });
  try {
    if (req.query.view === "digest") {
      const lang = DIGEST_LANGS.includes(req.query.lang) ? req.query.lang : "en", site = siteUrl(req);
      const d = await digestData({ site });
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
      return res.status(200).json({ date: new Date().toISOString().slice(0, 10), lang, text: buildDigest({ ...d, site, lang }), fresh: d.fresh.length, rates: d.rates });
    }
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
    if (!hasDb()) return res.status(200).json({ items: [] });
    const rows = await approvedRows();
    return res.status(200).json({ items: rows.map(toPublic) });
  } catch {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ items: [], error: "unavailable" });
  }
}
