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
| **Admin** | `/admin.html`: approve winners, read the radar, rank captains | DB + `ADMIN_TOKEN` |

Everything degrades gracefully: with no keys at all, the site still works (Drop, Board, You qualify, Sprint, quick scam check, listen).

## Files

```
public/index.html          page shell and styles
public/app.js              all app logic
public/i18n.js             interface text in 7 languages (missing keys fall back to English)
public/data/listings.json  rates, listings, eligibility rules  ← edit this daily
public/admin.html          owner dashboard
public/share.js            status-image maker
public/sw.js               offline + instant loading
public/manifest.webmanifest, public/icons/  install metadata, icons, link-preview image
api/*.js                   server functions (check, radar, coach, translate, proof, captain, admin, health)
api/_lib.js                shared helpers (not a route)
supabase/schema.sql        database tables, all private (RLS on, no public policies)
scripts/check-listings.mjs daily data checker (also runs in GitHub Actions)
launch-kit/                7 launch-week status images + captions (English and Pidgin)
```

## Setup (about 20 minutes)

1. **Supabase**: create a free project at supabase.com → SQL Editor → paste `supabase/schema.sql` → Run. Copy the project URL and the **service_role** key from Project Settings → API.
2. **GitHub**: push this folder to your repo.
3. **Vercel**: Add New → Project → import the repo. Framework preset **Other**, no build command.
4. **Vercel → Settings → Environment Variables** (see `.env.example`): `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_TOKEN` (a long random password). Redeploy.
5. **Deadline alerts** (optional): run `npx web-push generate-vapid-keys` once on any computer with Node, then add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:you@…), `CRON_SECRET` (long random text) and `SITE_URL` (your live address) in Vercel. The daily job in `vercel.json` runs at 8am Lagos time. Re-run `supabase/schema.sql` so the `push_subs` table exists.
6. **Test**: visit `/api/health`. It should say `"ai":true,"db":true`. Then try Check a deal → "Try the Product Tube case".

Keys live only in Vercel. Never put them in code, commits or chat. If one leaks, rotate it immediately.

## Daily routine

1. Read the 5:34am draft and approve items.
2. Edit `public/data/listings.json`: `updated`, rates, new items, remove closed ones.
3. `npm run check` until "All good."
4. Commit; Vercel redeploys. Paste the digest into your channel.
5. Weekly: open `/admin.html`, approve verified winners, read the radar for the next Scam Watch story.

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
