-- FinTrack schema
-- Run this in Supabase → SQL Editor → New query

-- 1. Create Profiles Table (linked to Supabase Auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text unique not null,
  name text not null,
  password_hash text default '', -- Legacy support, not needed for native auth
  created_at timestamptz default now()
);

-- 2. Create Transactions Table
create table if not exists public.transactions (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null,
  category text not null,
  note text default '',
  date timestamptz not null,
  created_at timestamptz default now()
);

-- 3. Create Budgets Table
create table if not exists public.budgets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  monthly numeric default 2400,
  weekly numeric default 600,
  categories jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- 4. Create Preferences Table
create table if not exists public.prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text default 'dark',
  accent text default '#C5FF4A',
  currency text default 'USD',
  onboarding_done boolean default false,
  weekly_budget numeric default 600,
  monthly_budget numeric default 2400,
  updated_at timestamptz default now()
);

-- 5. Create Wishlist Table
create table if not exists public.wishlist (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  target numeric not null,
  saved numeric default 0,
  emoji text default '🎯',
  color text default '#C5FF4A',
  created_at timestamptz default now()
);

-- 6. Enable Row Level Security (RLS) on all tables
alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.prefs enable row level security;
alter table public.wishlist enable row level security;

-- 7. Define Row Level Security (RLS) Policies

-- Profiles Policies
create policy "Users can view their own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id);

create policy "Users can insert their own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- Transactions Policies
create policy "Users can view their own transactions" on public.transactions
  for select using (auth.uid() = user_id);

create policy "Users can insert their own transactions" on public.transactions
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own transactions" on public.transactions
  for update using (auth.uid() = user_id);

create policy "Users can delete their own transactions" on public.transactions
  for delete using (auth.uid() = user_id);

-- Budgets Policies
create policy "Users can view their own budgets" on public.budgets
  for select using (auth.uid() = user_id);

create policy "Users can insert their own budgets" on public.budgets
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own budgets" on public.budgets
  for update using (auth.uid() = user_id);

create policy "Users can delete their own budgets" on public.budgets
  for delete using (auth.uid() = user_id);

-- Preferences Policies
create policy "Users can view their own preferences" on public.prefs
  for select using (auth.uid() = user_id);

create policy "Users can insert their own preferences" on public.prefs
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own preferences" on public.prefs
  for update using (auth.uid() = user_id);

create policy "Users can delete their own preferences" on public.prefs
  for delete using (auth.uid() = user_id);

-- Wishlist Policies
create policy "Users can view their own wishlist items" on public.wishlist
  for select using (auth.uid() = user_id);

create policy "Users can insert their own wishlist items" on public.wishlist
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own wishlist items" on public.wishlist
  for update using (auth.uid() = user_id);

create policy "Users can delete their own wishlist items" on public.wishlist
  for delete using (auth.uid() = user_id);

-- 8. PostgreSQL Trigger to automatically create profile, budget, and prefs on auth signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, password_hash)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    ''
  );

  insert into public.prefs (user_id, theme, accent, currency, onboarding_done, weekly_budget, monthly_budget)
  values (new.id, 'dark', '#C5FF4A', 'USD', false, 600, 2400);

  insert into public.budgets (user_id, monthly, weekly, categories)
  values (new.id, 2400, 600, '{}'::jsonb);

  return new;
end;
$$ language plpgsql security definer;

-- Bind the trigger function to insert on auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 9. Wallet Table (stores user balance)
create table if not exists public.wallet (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance numeric default 0 check (balance >= 0),
  updated_at timestamptz default now()
);

-- 10. Wallet Transactions Table (payment history)
create table if not exists public.wallet_transactions (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  type text not null check (type in ('credit', 'debit')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  razorpay_order_id text,
  razorpay_payment_id text,
  description text default '',
  verified_at timestamptz,
  created_at timestamptz default now()
);

-- 11. Enable RLS on wallet tables
alter table public.wallet enable row level security;
alter table public.wallet_transactions enable row level security;

-- Wallet Policies
create policy "Users can view their own wallet" on public.wallet
  for select using (auth.uid() = user_id);

create policy "Users can insert their own wallet" on public.wallet
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own wallet" on public.wallet
  for update using (auth.uid() = user_id);

-- Wallet Transactions Policies (users can read their own, inserts/updates done by service role)
create policy "Users can view their own wallet transactions" on public.wallet_transactions
  for select using (auth.uid() = user_id);

create policy "Service can insert wallet transactions" on public.wallet_transactions
  for insert with check (true);

create policy "Service can update wallet transactions" on public.wallet_transactions
  for update using (true);

-- 12. Add wallet creation to new user signup trigger
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, password_hash)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    ''
  );

  insert into public.prefs (user_id, theme, accent, currency, onboarding_done, weekly_budget, monthly_budget)
  values (new.id, 'dark', '#C5FF4A', 'USD', false, 600, 2400);

  insert into public.budgets (user_id, monthly, weekly, categories)
  values (new.id, 2400, 600, '{}'::jsonb);

  insert into public.wallet (user_id, balance)
  values (new.id, 0);

  return new;
end;
$$ language plpgsql security definer;

-- 13. Index for fast per-user queries
create index if not exists tx_user_date on public.transactions(user_id, date desc);
create index if not exists wishlist_user on public.wishlist(user_id);
create index if not exists wallet_tx_user on public.wallet_transactions(user_id, created_at desc);

-- 14. Migration: create wallet rows for existing users who signed up before the wallet feature
-- Run this once after deploying the wallet tables
insert into public.wallet (user_id, balance)
select id, 0 from public.profiles
where id not in (select user_id from public.wallet)
on conflict (user_id) do nothing;
