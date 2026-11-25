# Unshaken

A free, no-sign-up platform for verified ways to **earn, learn, grow and go abroad**, with a scam checker people can trust. Nobody registers, subscribes or pays. Personal answers stay on the visitor's own phone.

## Features

| Feature | What it does | Needs |
|---|---|---|
| **Today's Drop** | Five status-style stories: dollar rate, "doors for you", closing-first countdown, honest earning, scam watch | — |
| **Board** | Listings sorted by deadline, each with official link, steps, Save, Copy to share | — |
| **You qualify** | 6 questions (country, level, work, gender, field, student). The Board marks each door ✓ / check / not for you and puts yours first | — |
| **Check a deal** | Instant on-phone check, then a deeper AI verdict; shows how many others checked the same message | AI (optional) · DB for the count |
| **Scam Radar** | Every check is logged anonymously (phones, emails, links, wallets removed); weekly public summary on the Check page | DB |
| **Application Sprint** | Plans each deadline backwards into daily tasks; WhatsApp reminder text; calendar file | — |
| **Essay Coach** | Scores a statement of purpose on 6 panel criteria, with fixes and stronger sentences (never invents achievements) | AI |
| **Winners (Proof Wall)** | Winners upload their award letter privately; only first name, country and award show, after you approve | DB |
| **Campus Captains & OG Ladder** | Personal link; counts people brought in (one per phone) and shares; levels Starter → Connector → Captain → Gold OG. No money, ever | DB |
| **7 languages** | English, Pidgin, French, Yoruba, Hausa, Igbo, Swahili. All non-English labelled beta; listings translated by AI once and cached | AI · DB for cache |
| **Listen mode** | Reads the current screen aloud with the phone's own voices | — |
| **Naira value** | Award amounts (SEK, EUR, USD) shown as "≈ ₦1.62m a month" at the latest official rate | — |
| **One step away** | When the only gap is experience, the card says so and explains that SIWES, NYSC, internships and volunteering count | — |
| **Deadline alerts** | Push notification 7 days and 1 day before any saved or sprinted deadline, in the user's language. No account: only the browser's push address and listing ids are stored | DB + VAPID keys + `CRON_SECRET` |
| **Message writer** | Ready templates for asking a referee, emailing a professor and following up; optional AI personalisation | AI (optional) |
| **Live Scam Radar story** | Once 5+ deals are checked in a week, Today's Drop shows the week's top scam sign automatically | DB |
| **Installable app** | Add to Home Screen on Android/iPhone; opens instantly and reads offline (service worker); app shortcuts | — |
| **Status images** | One tap turns any listing, the dollar rate, a scam alert or a check result into a 1080×1920 WhatsApp-status picture with your Captain link | — |
| **App feel** | Bottom tab bar with a badge for today's sprint tasks, first-visit welcome, Board search, daily streak, light haptics | — |
| **Link previews** | Branded preview image and text when the link is pasted into WhatsApp, X or Facebook | — |
| **Approval queue** | `/admin` (PIN login): review drafts, edit any field, open the official page in a new tab, check the link, approve in one tap or in bulk, reject, take down. Past deadlines expire automatically. **Nothing reaches the public site unless you approve it** | DB + `ADMIN_PIN` |
| **Daily drafts** | The daily job reads the official sources in `config/sources.json` (RSS feeds; web pages too when AI is on) and saves new items as drafts, deduped by link, each with its source URL. It never approves anything | DB (AI optional) |
| **Daily digest** | `/digest` page + Telegram auto-post: dollar/pound/euro → naira and GH₵, KSh, R, CFA, E£ (free open.er-api.com), today's approved doors, what closes first, one always-open pick. One-tap copy and WhatsApp share | Telegram bot (optional) |
| **Admin** | `/admin`: approval queue, digest, winners' proofs, Scam Radar, captains. 7 languages (non-English marked machine-translated beta) | DB + `ADMIN_PIN` |

Everything degrades gracefully: with no keys at all, the site still works (Drop, Board, You qualify, Sprint, quick scam check, listen).

## Files

```
public/index.html          page shell and styles
public/app.js              all app logic
public/i18n.js             interface text in 7 languages (missing keys fall back to English)
public/data/listings.json  rates, listings, eligibility rules  ← edit this daily
public/admin.html          owner dashboard (/admin): approval queue, digest, proofs, radar, captains
public/digest.html         public daily digest (/digest) with copy + WhatsApp/Telegram share
public/i18n-ops.js         admin + digest text in 7 languages
public/share.js            status-image maker
public/sw.js               offline + instant loading
public/manifest.webmanifest, public/icons/  install metadata, icons, link-preview image
api/*.js                   server functions (check, radar, coach, translate, proof, captain, admin, health)
api/listings.js            public: approved listings only, and the digest text
api/cron-alerts.js         the daily job: expire → Telegram digest → deadline alerts → new drafts
api/_lib.js                shared helpers incl. PIN + session cookie (not a route)
api/_queue.js              queue rules, feed reader, AI drafting, rates, digest, Telegram (not a route)
config/sources.json        the curated official sources the draft generator reads ← edit to add/remove
supabase/schema.sql        database tables, all private (RLS on, no public policies)
supabase/002_listings.sql  listings queue + digest log (run after schema.sql)
supabase/seed_listings.sql first 20 researched listings, as DRAFTS (from supabase/seed/*.json; rebuild with node scripts/seed-sql.mjs)
scripts/test-api.mjs       API tests with mocked Supabase/AI/rates/Telegram: node scripts/test-api.mjs
scripts/check-listings.mjs daily data checker (also runs in GitHub Actions)
launch-kit/                7 launch-week status images + captions (English and Pidgin)
```

## Setup (about 20 minutes)

1. **Supabase**: create a free project at supabase.com → SQL Editor → paste `supabase/schema.sql` → Run. Copy the project URL and the **service_role** key from Project Settings → API.
2. **GitHub**: push this folder to your repo.
3. **Vercel**: Add New → Project → import the repo. Framework preset **Other**, no build command.
4. **Vercel → Settings → Environment Variables** (see `.env.example`): `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PIN` (6+ characters, only you know it), `CRON_SECRET` (long random text), `SITE_URL`. Redeploy.
5. **Deadline alerts** (optional): run `npx web-push generate-vapid-keys` once on any computer with Node, then add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:you@…), `CRON_SECRET` (long random text) and `SITE_URL` (your live address) in Vercel. The daily job in `vercel.json` runs at 8am Lagos time. Re-run `supabase/schema.sql` so the `push_subs` table exists.
6. **Test**: visit `/api/health`. It should say `"ai":true,"db":true`. Then try Check a deal → "Try the Product Tube case".

### Approval queue, daily drafts and digest (about 10 more minutes)

1. **Tables**: Supabase → SQL Editor → paste `supabase/002_listings.sql` → Run. Then paste `supabase/seed_listings.sql` → Run. That loads 20 researched, verified (25 Nov 2026), free-to-apply listings **as drafts**.
2. **PIN**: set `ADMIN_PIN` in Vercel (the PIN is compared as a hash; to keep only the hash in Vercel, set `ADMIN_PIN=sha256:<hash>` where the hash is `sha256("unshaken-pin:" + PIN)`, e.g. `node -e "console.log(require('crypto').createHash('sha256').update('unshaken-pin:YOURPIN').digest('hex'))"`). Login lasts 12 hours in an HttpOnly cookie; 8 wrong tries lock that device out for 15 minutes.
3. **Cron**: `vercel.json` already runs `/api/cron-alerts` every day at 07:00 UTC (8am West Africa). Vercel sends `CRON_SECRET` automatically. Each run: expires past deadlines → posts the digest to Telegram (once a day) → sends deadline alerts → fetches new drafts. Run a single step by hand: `curl -H "Authorization: Bearer $CRON_SECRET" "https://your-site/api/cron-alerts?task=drafts"` (or `expire`, `digest`, `alerts`). Functions may run up to 60 s.
4. **Drafts**: with `OPENAI_API_KEY` the generator reads each new item's official page and fills in the card (it must use links that appear on that page, skips anything that asks for a fee, and marks it "AI draft: check every detail"). Without a key it still saves RSS items as raw drafts for you to complete. Sources live in `config/sources.json`: official sites only; set `"enabled": false` to pause one. Any feed that fails shows in the admin "Fetch new drafts now" report.
5. **Telegram**: in Telegram, message **@BotFather** → `/newbot` → copy the token. Create your channel, add the bot as an **administrator** with "Post messages". Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID` (`@yourchannel`, or the `-100…` id for a private channel). Optional `DIGEST_LANG` (en, pcm, fr, yo, ha, ig, sw). Test with **Post to Telegram now** in `/admin` → Daily digest.
6. **WhatsApp**: WhatsApp has no API for posting to Channels, and the Business API only sends one-to-one messages to people who opted in (paid). So the digest page and admin give you one-tap **Copy text** and **Share on WhatsApp** (wa.me) instead.

Limits worth knowing: the Vercel Hobby plan allows 12 functions; this project now has exactly 12 routes in `api/` (files starting with `_` don't count). Add new features to existing routes rather than new files.

Keys live only in Vercel. Never put them in code, commits or chat. If one leaks, rotate it immediately.

## Daily routine (5 minutes, on your phone)

1. Open **/admin** → enter your PIN → **Approval queue → Drafts**.
2. For each draft: tap **Open official page ↗** (new tab), compare deadline, eligibility and steps; fix any field; tap **Approve** (or **Reject**). Yellow text tells you what's missing before it can go live. If several are already right, tick them and tap **Approve selected**.
3. Tap **Daily digest** → **Copy text** → paste into your WhatsApp Channel/status (or **Share on WhatsApp**). Telegram posts itself at 8am; tap **Post to Telegram now** if you approved things later and want them out today.
4. Weekly: **Live** tab — take down anything that changed; **Proofs** — approve verified winners; **Scam Radar** — pick the week's Scam Watch story. Rejected links never come back as drafts.

`public/data/listings.json` still works as before (your hand-curated list, rates and eligibility rules); approved queue items are added on top of it. Run `npm run check` after editing it.

## Listing format

```json
{
  "id": "short-unique-id", "cat": "Go | Earn | Learn | Grow",
  "title": "Official name", "due": "2027-01-15T22:59:00Z", "dueText": "15 Jan 2027",
  "get": "What they receive", "who": "Who is eligible",
  "steps": ["Step 1", "Step 2", "Step 3"], "link": "https://official-site",
  "flag": "Optional: why this needs confirming",
  "elig": { "levels": ["master"], "exclude": "EU", "countries": ["NG"], "region": "AFRICA",
            "gender": "female", "fields": ["stem"], "student": true, "minWork": 1.5, "partnerCheck": true }
}
```
Optional `"amount": {"cur":"SEK","value":12000,"per":"month"}` (also `max`, `per` once|month|year|total) shows the naira value. Add the currency to `rates` (e.g. `"sek": {"ngn":134.62,"date":"…","source":"…"}`).
`"rolling": true` = always open (no `due`). `"opens": true` = `due` is the opening date. Leave `elig` empty (`{}`) for open-to-all. `exclude` takes a region name (`EU`, which includes EEA and Switzerland) or a list of country codes.

## House rules (what makes the ✓ mean something)

- Official links only. No "agents", no blogs as the source.
- Nothing that asks for a fee to apply or to unlock earnings.
- No VPN or location workarounds.
- Partner links are always labelled.
- No invented numbers, testimonials or winners. A winner shows only after you see their letter.
