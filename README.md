# Unshaken

Free, no-sign-up platform: a daily **Drop** (rates, closing-soon opportunities, scam watch), a **Board** of verified ways to earn, learn, grow and go abroad, and a **Check a deal** scam checker.

Nobody registers, subscribes or pays. Saved items stay on the visitor's own phone.

## What's inside

| Path | What it does |
|---|---|
| `public/index.html` | The whole app (Drop, Board, Check). No build step. |
| `public/data/listings.json` | Rates + every listing. **This is the only file you edit day to day.** |
| `api/check.js` | Scam-check API. Calls OpenAI with your key, which stays on the server. |
| `scripts/check-listings.mjs` | Flags closed listings, ones closing within 7 days, stale rates, missing fields. |
| `.github/workflows/listings.yml` | Runs that check daily and whenever the data changes. |

If the AI check is down or not configured, the page still gives every visitor a quick on-phone check. Nothing breaks.

## Deploy (about 10 minutes)

1. Push this folder to your GitHub repo.
2. On [vercel.com](https://vercel.com): **Add New → Project → Import** the repo. Framework preset: **Other**. Leave the build command empty.
3. **Settings → Environment Variables**: add `OPENAI_API_KEY` (and `OPENAI_MODEL` if you want a different model). Redeploy.
4. Open your site, go to **Check a deal**, tap **Try the Product Tube case**, then **Check it**. "Checked with AI" means the key works.

**Never** put the key in `index.html`, in a commit, or in chat. If it ever leaks, revoke it at platform.openai.com and make a new one.

## Daily routine (about 10 minutes)

1. The 5:34am scheduled draft arrives with today's rates, 3 closing-soon items, new finds and a scam warning.
2. Approve the items you want.
3. Update `public/data/listings.json`: rates and `updated` date, add approved items, remove closed ones.
4. Run `npm run check`; it should end with "All good."
5. Commit → Vercel redeploys automatically → paste the digest into your WhatsApp/Telegram channel.

## Listing format

```json
{
  "id": "short-unique-id",
  "cat": "Go | Earn | Learn | Grow",
  "title": "Official programme name",
  "due": "2027-01-15T22:59:00Z",
  "dueText": "15 Jan 2027",
  "get": "What the person receives",
  "who": "Who is eligible",
  "steps": ["Step 1", "Step 2", "Step 3"],
  "link": "https://official-site",
  "flag": "Optional: why this still needs confirming"
}
```

Use `"rolling": true` (and no `due`) for always-open items, and `"opens": true` when `due` is an opening date.

## House rules (what makes the ✓ mean something)

- Official links only: the provider's own site, never a blog or an "agent".
- No listing that asks for a fee to apply or unlock earnings.
- No VPN or location workarounds.
- Partner (affiliate) links are always labelled.
- No invented numbers, testimonials or results.
