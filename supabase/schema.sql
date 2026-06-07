-- Wealth Tracker — Supabase schema
-- Run this entire file in the Supabase SQL editor of a fresh project.
-- Idempotent: safe to re-run (uses `if not exists` and `drop policy if exists`).
--
-- Security model:
--   * Every user table has a `user_id uuid references auth.users` column.
--   * RLS is enabled on every user table with a single policy: `auth.uid() = user_id`.
--   * `price_cache` is a server-only table (no RLS, accessed only with the service-role key).

-- ============================================================================
-- Extensions
-- ============================================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================================
-- accounts
-- ============================================================================
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  type        text not null check (type in ('cash','savings','brokerage','retirement','crypto','other')),
  currency    text not null default 'USD' check (char_length(currency) = 3),
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists accounts_user_id_idx on public.accounts(user_id);

alter table public.accounts enable row level security;
drop policy if exists "accounts: owner full access" on public.accounts;
create policy "accounts: owner full access" on public.accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- transactions
-- ============================================================================
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  kind         text not null check (kind in ('income','savings_deposit','savings_withdrawal','expense')),
  amount       numeric(14,2) not null check (amount >= 0),
  category     text check (category is null or char_length(category) between 1 and 60),
  note         text check (note is null or char_length(note) <= 500),
  occurred_on  date not null,
  created_at   timestamptz not null default now()
);
create index if not exists transactions_user_id_idx       on public.transactions(user_id);
create index if not exists transactions_occurred_on_idx   on public.transactions(occurred_on desc);
create index if not exists transactions_account_id_idx    on public.transactions(account_id);

alter table public.transactions enable row level security;
drop policy if exists "transactions: owner full access" on public.transactions;
create policy "transactions: owner full access" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- savings_goals
-- ============================================================================
create table if not exists public.savings_goals (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  name                 text not null check (char_length(name) between 1 and 80),
  target_amount        numeric(14,2) not null check (target_amount > 0),
  target_date          date,
  monthly_contribution numeric(14,2) not null default 0 check (monthly_contribution >= 0),
  linked_account_id    uuid references public.accounts(id) on delete set null,
  created_at           timestamptz not null default now()
);
create index if not exists savings_goals_user_id_idx on public.savings_goals(user_id);

alter table public.savings_goals enable row level security;
drop policy if exists "savings_goals: owner full access" on public.savings_goals;
create policy "savings_goals: owner full access" on public.savings_goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- holdings
-- ============================================================================
create table if not exists public.holdings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  symbol      text not null check (char_length(symbol) between 1 and 20),
  asset_type  text not null check (asset_type in ('stock','etf','crypto')),
  quantity    numeric(18,8) not null check (quantity >= 0),
  cost_basis  numeric(14,2) not null check (cost_basis >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists holdings_user_id_idx    on public.holdings(user_id);
create index if not exists holdings_account_id_idx on public.holdings(account_id);

alter table public.holdings enable row level security;
drop policy if exists "holdings: owner full access" on public.holdings;
create policy "holdings: owner full access" on public.holdings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- holding_lots (Phase 4 — tax-lot accounting)
-- A holding's total quantity and cost basis are the SUM of its lots.
-- Each lot represents one acquisition event with its own acquired_on date,
-- which drives long-term vs short-term classification (Phase 4+ work).
-- ============================================================================
create table if not exists public.holding_lots (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  holding_id            uuid not null references public.holdings(id) on delete cascade,
  -- Match the precision of holdings exactly.
  quantity              numeric(18,8) not null check (quantity >= 0),
  cost_basis            numeric(14,2) not null check (cost_basis >= 0),
  acquired_on           date not null,
  acquired_on_estimated boolean not null default false,
  created_at            timestamptz not null default now()
);
create index if not exists holding_lots_user_id_idx    on public.holding_lots(user_id);
create index if not exists holding_lots_holding_id_idx on public.holding_lots(holding_id);

alter table public.holding_lots enable row level security;
drop policy if exists "holding_lots: owner full access" on public.holding_lots;
create policy "holding_lots: owner full access" on public.holding_lots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Pin the classification contract for `acquired_on_estimated` into the catalog
-- so it travels with the DB. See supabase/migrations/0003_holding_lots.sql
-- header for the full contract — short version: code that classifies lots
-- as long-term / short-term MUST check `acquired_on_estimated` first and treat
-- true lots as "needs review" rather than using `acquired_on` as input.
comment on table public.holding_lots is
  'Per-acquisition lots that roll up into a holding. sum(quantity) = holdings.quantity and sum(cost_basis) = holdings.cost_basis to the cent.';
comment on column public.holding_lots.acquired_on is
  'The date the lot was opened. For lots with acquired_on_estimated = true, this is a placeholder and MUST NOT be used for LT/ST classification.';
comment on column public.holding_lots.acquired_on_estimated is
  'true = acquired_on is a placeholder, not user-confirmed. Classification code must check this flag first.';

-- ============================================================================
-- account_snapshots
-- ============================================================================
create table if not exists public.account_snapshots (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  balance       numeric(14,2) not null,
  snapshot_date date not null,
  created_at    timestamptz not null default now(),
  unique (account_id, snapshot_date)
);
create index if not exists account_snapshots_user_id_idx       on public.account_snapshots(user_id);
create index if not exists account_snapshots_snapshot_date_idx on public.account_snapshots(snapshot_date desc);

alter table public.account_snapshots enable row level security;
drop policy if exists "account_snapshots: owner full access" on public.account_snapshots;
create policy "account_snapshots: owner full access" on public.account_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- price_cache (server-only — RLS deliberately enabled with no policies,
-- so anon/authenticated cannot read or write. Service-role bypasses RLS.)
-- ============================================================================
create table if not exists public.price_cache (
  symbol     text primary key check (char_length(symbol) between 1 and 20),
  price      numeric(14,4) not null,
  currency   text not null default 'USD' check (char_length(currency) = 3),
  fetched_at timestamptz not null default now()
);
alter table public.price_cache enable row level security;
-- intentionally no policies — only service role may read/write

-- ============================================================================
-- user_settings (default currency, inflation assumption, etc.)
-- One row per user, keyed by user_id.
-- ============================================================================
create table if not exists public.user_settings (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  default_currency     text not null default 'USD' check (char_length(default_currency) = 3),
  inflation_assumption numeric(5,2) not null default 3.00 check (inflation_assumption >= 0 and inflation_assumption <= 50),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.user_settings enable row level security;
drop policy if exists "user_settings: owner full access" on public.user_settings;
create policy "user_settings: owner full access" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- scenarios (Step 10 — Household Wealth Simulator)
-- The full scenario config is stored as jsonb in `assumptions` so the
-- simulator can evolve without per-field migrations. Shape is validated
-- with zod on the server before insert/update.
-- ============================================================================
create table if not exists public.scenarios (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  assumptions jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists scenarios_user_id_idx on public.scenarios(user_id);

alter table public.scenarios enable row level security;
drop policy if exists "scenarios: owner full access" on public.scenarios;
create policy "scenarios: owner full access" on public.scenarios
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Touch updated_at on every UPDATE. SECURITY INVOKER (the default) is
-- correct here — the trigger should run with the row owner's permissions,
-- not as an elevated definer, so this is not the SECURITY DEFINER
-- exposure flagged in CLAUDE.md's "Known security debt".
create or replace function public.scenarios_set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists scenarios_set_updated_at on public.scenarios;
create trigger scenarios_set_updated_at before update on public.scenarios
  for each row execute function public.scenarios_set_updated_at();
