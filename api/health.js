// GET /api/health → which features are switched on (no secrets revealed)
import { hasAi, hasDb } from "./_lib.js";
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, ai: hasAi(), db: hasDb() });
}
