-- Unshaken migration 002: daily approval queue for listings + digest log.
-- Run AFTER schema.sql: Supabase → SQL Editor → paste → Run. Safe to run more than once.
-- Like every other table, RLS is ON with NO public policies: only the server (service role) reads or writes.
-- The public site only ever receives rows with status = 'approved' (filtered in /api/listings).

create table if not exists listings (
  id          text primary key,                         -- short slug, e.g. "cern-summer-2027"
  status      text not null default 'draft'
              check (status in ('draft','approved','rejected','expired')),
  cat         text not null default 'Learn' check (cat in ('Go','Earn','Learn','Grow')),
  title       text not null check (char_length(title) between 3 and 200),
  get         text,                                      -- what people receive
  who         text,                                      -- who is eligible
  steps       jsonb not null default '[]'::jsonb,        -- ["Step 1", "Step 2", ...]
  link        text not null,                             -- official page (https)
  link_norm   text not null,                             -- normalised link, used to dedupe
  source_url  text not null,                             -- where the draft came from (feed item, page or research)
  due         timestamptz,                               -- deadline (null when rolling)
  due_text    text,                                      -- human deadline, e.g. "21 Jan 2027, 23:59 Geneva"
  rolling     boolean not null default false,            -- always open
  opens       boolean not null default false,            -- due is the OPENING date
  elig        jsonb not null default '{}'::jsonb,        -- same shape as listings.json "elig"
  amount      jsonb,                                     -- optional {"cur":"CHF","value":94,"per":"day"}
  tags        text[] not null default '{}',
  flag        text,                                      -- shown on the card: what to confirm
  notes       text,                                      -- private notes for the owner (never public)
  origin      text not null default 'manual' check (origin in ('seed','ai','rss','manual')),
  verified_on date,                                      -- date the official page was checked
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  approved_at timestamptz,
  reviewed_at timestamptz
);
create unique index if not exists listings_link_norm_idx on listings (link_norm);
create index if not exists listings_status_idx on listings (status, created_at desc);
create index if not exists listings_due_idx on listings (due) where status in ('draft','approved');
alter table listings enable row level security;

-- One row per day the digest was auto-posted, so the cron never posts twice.
create table if not exists digest_log (
  day        date primary key,
  posted_at  timestamptz not null default now(),
  channel    text not null default 'telegram',
  items      int not null default 0
);
alter table digest_log enable row level security;

-- Optional helper you can run by hand at any time (the daily job also does this):
-- update listings set status = 'expired', reviewed_at = now()
--  where status in ('draft','approved') and rolling = false and opens = false and due < now();
