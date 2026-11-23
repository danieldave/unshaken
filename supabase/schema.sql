-- Unshaken database. Paste into Supabase → SQL Editor → Run.
-- Every table has Row Level Security ON with NO public policies:
-- only the server (service role key, kept in Vercel) can read or write.

create extension if not exists pgcrypto;

-- 1. Scam Radar: anonymised record of every "Check a deal"
create table if not exists radar_checks (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  text_hash text not null,                 -- sha256 of the normalised message, for "N people checked this"
  snippet text,                            -- first 280 chars with phones, emails, links removed
  verdict text not null check (verdict in ('green','orange','red')),
  flags text[] not null default '{}',
  source text not null default 'ai',       -- 'ai' or 'rules'
  lang text
);
create index if not exists radar_hash_idx on radar_checks (text_hash);
create index if not exists radar_time_idx on radar_checks (created_at desc);

-- 2. Proof Wall: winners' submissions; only approved rows are ever shown
create table if not exists proofs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null check (char_length(first_name) between 1 and 40),
  country text not null check (char_length(country) between 2 and 60),
  programme text not null check (char_length(programme) between 2 and 120),
  year int check (year between 2020 and 2035),
  file_path text not null,                 -- private storage path of the award letter
  contact text,                            -- optional, never shown publicly
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at timestamptz
);
create index if not exists proofs_status_idx on proofs (status, created_at desc);

-- 3. Campus Captains and the OG Ladder
create table if not exists captains (
  code text primary key,                   -- short public code, e.g. AMK7Q2
  created_at timestamptz not null default now(),
  display_name text check (char_length(display_name) <= 40),
  group_name text check (char_length(group_name) <= 80),
  secret text not null                     -- lets the captain view their own stats
);

create table if not exists ref_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  code text not null references captains(code) on delete cascade,
  kind text not null check (kind in ('visit','share')),
  device text not null,                    -- random per-device id, so one phone counts once
  unique (code, kind, device)
);

-- 4. Translation cache (so each listing is translated once per language)
create table if not exists translations (
  key text not null,
  lang text not null,
  body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, lang)
);

alter table radar_checks enable row level security;
alter table proofs       enable row level security;
alter table captains     enable row level security;
alter table ref_events   enable row level security;
alter table translations enable row level security;

-- Private bucket for award letters (never public)
insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', false)
on conflict (id) do nothing;

-- 5. Deadline alerts (web push). Anonymous: only the browser's push address and the saved listing ids.
create table if not exists push_subs (
  endpoint text primary key,
  keys jsonb not null,                     -- p256dh + auth from the browser
  items text[] not null default '{}',      -- listing ids this phone saved or is sprinting on
  lang text,
  sent jsonb not null default '{}',        -- {"<id>:7": true, "<id>:1": true} so each alert goes once
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table push_subs enable row level security;
