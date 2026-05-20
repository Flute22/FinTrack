-- FinTrack schema
-- Run this in Supabase → SQL Editor → New query

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  password_hash text not null,
  created_at timestamptz default now()
);

create table if not exists transactions (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  amount numeric not null,
  category text not null,
  note text default '',
  date timestamptz not null,
  created_at timestamptz default now()
);

create table if not exists budgets (
  user_id uuid primary key references profiles(id) on delete cascade,
  monthly numeric default 2400,
  weekly numeric default 600,
  categories jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists prefs (
  user_id uuid primary key references profiles(id) on delete cascade,
  theme text default 'dark',
  accent text default '#C5FF4A',
  currency text default 'USD',
  onboarding_done boolean default false,
  weekly_budget numeric default 600,
  monthly_budget numeric default 2400,
  updated_at timestamptz default now()
);

create table if not exists wishlist (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  target numeric not null,
  saved numeric default 0,
  emoji text default '🎯',
  color text default '#C5FF4A',
  created_at timestamptz default now()
);

-- Disable RLS so the anon key can read/write freely (personal app, no server)
alter table profiles disable row level security;
alter table transactions disable row level security;
alter table budgets disable row level security;
alter table prefs disable row level security;
alter table wishlist disable row level security;

-- Index for fast per-user queries
create index if not exists tx_user_date on transactions(user_id, date desc);
create index if not exists wishlist_user on wishlist(user_id);
