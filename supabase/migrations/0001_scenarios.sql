-- Step 10 — Household Wealth Simulator
-- Apply against a project that's already running the canonical
-- supabase/schema.sql. Idempotent (drop/create policy + create if not exists),
-- so re-running is safe.

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
