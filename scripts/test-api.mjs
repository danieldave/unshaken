// Run: node scripts/test-api.mjs — exercises the API handlers with a mocked Supabase, OpenAI, rates API, feeds and Telegram.
// No network, no keys needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

Object.assign(process.env, {
  SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "service-key", ADMIN_PIN: "246810", CRON_SECRET: "cron-secret",
  TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHANNEL_ID: "@unshaken_test", SITE_URL: "https://site.test", OPENAI_API_KEY: ""
});

/* ---------- in-memory PostgREST ---------- */
const db = { listings: [], digest_log: [], push_subs: [] };
const calls = { telegram: [], openai: 0 };
const parseVal = v => v === "true" ? true : v === "false" ? false : v === "null" ? null : decodeURIComponent(v);
function filt(rows, params) {
  return rows.filter(r => [...params].every(([k, v]) => {
    if (["select", "order", "limit", "on_conflict"].includes(k)) return true;
    const [op, ...rest] = v.split("."), val = rest.join(".");
    if (op === "eq") return r[k] === parseVal(val) || String(r[k]) === decodeURIComponent(val);
    if (op === "lt") return r[k] !== null && new Date(r[k]) < new Date(decodeURIComponent(val));
    if (op === "in") { const list = decodeURIComponent(val).replace(/^\(|\)$/g, "").split(",").map(s => s.replace(/^"|"$/g, "")); return list.includes(String(r[k])); }
    return true;
  }));
}
const listingDefaults = { status: "draft", steps: [], elig: {}, tags: [], rolling: false, opens: false, due: null, approved_at: null, created_at: new Date().toISOString() };
async function supabase(url, opts) {
  const u = new URL(url), table = u.pathname.split("/").pop(), rows = db[table], method = opts.method || "GET";
  const body = opts.body ? JSON.parse(opts.body) : null;
  const json = d => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } });
  if (method === "GET") return json(filt(rows, u.searchParams));
  if (method === "PATCH") { const hit = filt(rows, u.searchParams); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === "POST") {
    const key = u.searchParams.get("on_conflict"), merge = /merge-duplicates/.test(opts.headers.Prefer || ""), added = [];
    for (const r of [].concat(body)) {
      const ex = key && rows.find(x => x[key] === r[key]);
      if (ex) { if (merge) Object.assign(ex, r); continue; }
      const row = table === "listings" ? { ...listingDefaults, ...r } : { posted_at: new Date().toISOString(), ...r };
      rows.push(row); added.push(row);
    }
    return json(added);
  }
  return json([]);
}
const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Applications open: Example Scholarship 2027</title><link>https://example.org/scholarship?utm_source=rss</link><description><![CDATA[<p>Fully funded scholarship applications are open.</p>]]></description><pubDate>${new Date().toUTCString()}</pubDate></item>
<item><title>Annual report published</title><link>https://example.org/report</link><description>Nothing to apply for.</description><pubDate>${new Date().toUTCString()}</pubDate></item>
<item><title>Applications open: Example Scholarship 2027 (again)</title><link>https://www.example.org/scholarship/</link><description>scholarship duplicate</description></item>
</channel></rss>`;
const ATOM = `<feed><entry><title>New fellowship call</title><link rel="alternate" href="https://gov.example/fellowship"/><summary>fellowship applications open</summary><updated>${new Date().toISOString()}</updated></entry></feed>`;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith("https://sb.test/rest/v1/")) return supabase(url, opts);
  if (url.startsWith("https://open.er-api.com/")) return new Response(JSON.stringify({ result: "success", time_last_update_utc: "Wed, 25 Nov 2026 00:02:31 +0000", rates: { USD: 1, NGN: 1450.5, GBP: 0.79, EUR: 0.92, GHS: 15.2, KES: 129.4, ZAR: 18.1, XOF: 603, EGP: 49.2, UGX: 3700, INR: 84 } }), { status: 200 });
  if (url.startsWith("https://api.telegram.org/")) { calls.telegram.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
  if (url === "https://site.test/data/listings.json") return new Response(readFileSync(new URL("../public/data/listings.json", import.meta.url)), { status: 200 });
  if (url.startsWith("https://cscuk.fcdo.gov.uk/feed")) return new Response(RSS, { status: 200 });
  if (url.startsWith("https://www.gov.uk/")) return new Response(ATOM, { status: 200 });
  if (url.startsWith("https://reliefweb.int/")) return new Response("nope", { status: 503 });
  if (url.startsWith("https://api.openai.com/")) { calls.openai++; return new Response("{}", { status: 500 }); }
  return new Response("<html><a href='https://x.test/a'>A</a></html>", { status: 200 });
};

/* ---------- tiny req/res ---------- */
function mk({ method = "GET", query = {}, body, headers = {} } = {}) {
  const res = { code: 0, headers: {}, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
  const req = { method, query, body, headers: { "x-forwarded-for": "1.2.3." + Math.floor(Math.random() * 250), ...(body ? { "content-type": "application/json" } : {}), ...headers } };
  return { req, res };
}
const run = async (h, o) => { const { req, res } = mk(o); await h(req, res); return res; };

const admin = (await import("../api/admin.js")).default;
const listings = (await import("../api/listings.js")).default;
const cron = (await import("../api/cron-alerts.js")).default;
const Q = await import("../api/_queue.js");

// seed: load the 20 researched drafts
const seed = JSON.parse(readFileSync(new URL("../supabase/seed/listings-2026-11-25.json", import.meta.url)));
for (const it of seed.items) db.listings.push({ ...listingDefaults, ...it, link_norm: Q.normUrl(it.link), origin: "seed", verified_on: seed.verified_on, status: "draft" });
assert.equal(db.listings.length, 20);

// 1. unit helpers
assert.equal(Q.normUrl("https://www.Example.org/a/?utm_source=x&b=1#top"), "example.org/a?b=1");
assert.equal(Q.parseFeed(RSS).length, 3);
assert.equal(Q.parseFeed(ATOM)[0].link, "https://gov.example/fellowship");
assert.deepEqual(Q.problems({ title: "Hi there", link: "http://x", cat: "Go", steps: [], rolling: false }).sort(), ["due", "get", "link", "source", "steps", "who"].sort());
assert.ok(Q.toTelegramHtml("*Bold* <x> & https://a.b/c_d_e").includes("<b>Bold</b> &lt;x&gt; &amp; https://a.b/c_d_e"));

// 2. public endpoint shows nothing while everything is a draft
let r = await run(listings, {});
assert.equal(r.code, 200); assert.equal(r.body.items.length, 0, "drafts must never be public");

// 3. admin auth
r = await run(admin, { query: { view: "queue" } }); assert.equal(r.code, 401);
r = await run(admin, { method: "POST", body: { action: "login", pin: "000000" } }); assert.equal(r.body.ok, false); assert.ok(!r.headers["set-cookie"]);
r = await run(admin, { query: { view: "session" } }); assert.equal(r.body.ok, false);
r = await run(admin, { method: "POST", body: { action: "login", pin: "246810" } }); assert.equal(r.code, 200);
const cookie = r.headers["set-cookie"]; assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
const auth = { cookie: cookie.split(";")[0] };
r = await run(admin, { method: "POST", body: { action: "listing.expire" }, headers: { ...auth, "content-type": "text/plain" } }); assert.equal(r.code, 415, "non-JSON POST refused");

// 4. queue + approve one + bulk + reject
r = await run(admin, { query: { view: "queue", status: "draft" }, headers: auth });
assert.equal(r.code, 200); assert.equal(r.body.counts.draft, 20); assert.ok(r.body.items.every(i => Array.isArray(i.problems)));
r = await run(admin, { method: "POST", headers: auth, body: { action: "listing.approve", ids: ["cern-summer-2027"], fields: { title: "CERN Summer Student Programme 2027" } } });
assert.deepEqual(r.body.approved, ["cern-summer-2027"]);
r = await run(admin, { method: "POST", headers: auth, body: { action: "listing.approve", ids: ["kaggle-learn", "ibm-skillsbuild"] } });
assert.equal(r.body.approved.length, 2);
r = await run(admin, { method: "POST", headers: auth, body: { action: "listing.reject", ids: ["toloka-tolokers"] } }); assert.equal(r.code, 200);
db.listings.push({ ...listingDefaults, id: "bad-draft-aaaaaa", title: "Half-filled", cat: "Go", link: "https://x.org/a", link_norm: "x.org/a", source_url: "https://x.org" });
r = await run(admin, { method: "POST", headers: auth, body: { action: "listing.approve", ids: ["bad-draft-aaaaaa"] } });
assert.deepEqual(r.body.approved, []); assert.ok(r.body.blocked["bad-draft-aaaaaa"].includes("steps"));
r = await run(admin, { method: "POST", headers: auth, body: { action: "listing.update", id: "bad-draft-aaaaaa", fields: { link: "javascript:alert(1)" } } }); assert.equal(r.code, 400);

// 5. public endpoint now shows exactly the approved ones, without private notes
r = await run(listings, {});
assert.deepEqual(r.body.items.map(i => i.id).sort(), ["cern-summer-2027", "ibm-skillsbuild", "kaggle-learn"]);
assert.ok(r.body.items.every(i => !("notes" in i) && !("status" in i)));

// 6. auto-expire past deadlines
db.listings.find(x => x.id === "kaggle-learn").rolling = true;
const old = db.listings.find(x => x.id === "yenching-2027"); old.due = "2020-01-01T00:00:00Z";
r = await run(admin, { method: "POST", headers: auth, body: { action: "listing.expire" } });
assert.ok(r.body.expired >= 1); assert.equal(old.status, "expired");

// 7. digest (public + admin) and Telegram post
r = await run(listings, { query: { view: "digest", lang: "en" } });
assert.match(r.body.text, /\$1 = ₦1,450\.50/); assert.match(r.body.text, /CERN Summer Student Programme 2027/); assert.equal(r.body.fresh, 3);
for (const lang of Q.DIGEST_LANGS) { const x = await run(listings, { query: { view: "digest", lang } }); assert.ok(x.body.text.length > 100, lang); }
r = await run(admin, { query: { view: "digest" }, headers: auth }); assert.equal(r.body.telegram, true);
r = await run(admin, { method: "POST", headers: auth, body: { action: "digest.post" } }); assert.equal(r.body.ok, true);
assert.equal(calls.telegram.at(-1).parse_mode, "HTML"); assert.equal(calls.telegram.at(-1).chat_id, "@unshaken_test");

// 8. cron: auth, then everything; digest already posted today → skipped; drafts without AI = raw feed drafts, deduped
r = await run(cron, {}); assert.equal(r.code, 401);
r = await run(cron, { headers: { authorization: "Bearer cron-secret" } });
assert.equal(r.code, 200); assert.equal(r.body.digest.skipped, "already posted today"); assert.equal(r.body.alerts.skipped, "not configured");
const rep = r.body.drafts;
assert.equal(rep.ai, false); assert.ok(rep.created >= 2, JSON.stringify(rep)); assert.ok(rep.dupes >= 1); assert.ok(rep.errors.some(e => e.startsWith("reliefweb")));
const raw = db.listings.filter(x => x.origin === "rss");
assert.ok(raw.every(x => x.status === "draft" && x.source_url && x.link_norm), "drafts carry source URL, never approved");
assert.ok(!raw.some(x => /report/.test(x.link)), "keyword filter");
const before = db.listings.length;
r = await run(cron, { query: { task: "drafts" }, headers: { authorization: "Bearer cron-secret" } });
assert.equal(db.listings.length, before, "second run creates no duplicates"); assert.equal(r.body.drafts.created, 0);

// 9. with an AI key that fails, the generator falls back to raw drafts instead of crashing
process.env.OPENAI_API_KEY = "sk-test"; db.listings = db.listings.filter(x => x.origin !== "rss");
r = await run(cron, { query: { task: "drafts" }, headers: { authorization: "Bearer cron-secret" } });
assert.ok(r.body.drafts.created >= 2 && calls.openai > 0); process.env.OPENAI_API_KEY = "";

// 10. logout clears the cookie
r = await run(admin, { method: "POST", headers: auth, body: { action: "logout" } }); assert.match(r.headers["set-cookie"], /Max-Age=0/);

console.log("All API tests passed.");
