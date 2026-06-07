-- Phase 4 — Tax lots.
--
-- Additive and forward-only. This migration:
--   1. Creates `public.holding_lots` (RLS enabled, owner-only policy).
--   2. Backfills one lot per existing holding so the lot sums exactly
--      match the holding totals. The migrated lot's `acquired_on` is set
--      to the holding's `created_at::date` (a placeholder that is NOT
--      authoritative — see contract below) and `acquired_on_estimated`
--      is flagged true so the UI can render the date as a placeholder
--      until the user supplies a real acquisition date.
--   3. Includes a transactional safety check that RAISES if the lot sums
--      don't equal the original holding totals to the cent — in that
--      case the whole transaction rolls back and no half-applied state
--      reaches the database.
--
-- ## CONTRACT: how downstream code MUST treat `acquired_on_estimated`
--
-- The `acquired_on` value for backfilled lots is `created_at::date`,
-- which is when the holding was first added to *tracker* — NOT the
-- actual acquisition date. For users who have been using the app for
-- years, this is a useful lower bound. For users who just installed
-- the app, this date is effectively "today," and using it as a
-- classification input would mislabel every existing position as
-- short-term.
--
-- Therefore the contract for any code that consumes lots is:
--
--   1. Long-term / short-term classification MUST first check
--      `acquired_on_estimated`. When true:
--        - DO NOT compute LT/ST from `acquired_on`.
--        - Render the lot as "acquisition date needs review" with a
--          CTA to set a real date.
--        - DO NOT include the lot in any aggregate tax-impact estimate
--          (LT vs ST gains, hypothetical-sale tax) until the user
--          replaces the estimated date with a real one.
--   2. Lots with `acquired_on_estimated = false` are user-confirmed
--      and may participate in classification + tax estimates per the
--      365-day rule.
--   3. Editing a lot's `acquired_on` in the UI MUST set
--      `acquired_on_estimated = false` as part of the same write —
--      the flag is only true on rows the user has never reviewed.
--
-- The `comment on column` statements below pin this contract into the
-- catalog so it's queryable from the DB (`\d+ holding_lots` in psql).
--
-- Self-hosters: take an encrypted backup from /settings/export BEFORE
-- applying this migration. Per project rule, migrations are forward-only
-- and the only safe rollback is restoring from a backup.
--
-- The migration is idempotent: re-running it does not create duplicate
-- lots (the backfill skips holdings that already have at least one lot).

begin;

-- ---------------------------------------------------------------------------
-- 1. New table
-- ---------------------------------------------------------------------------

create table if not exists public.holding_lots (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  holding_id            uuid not null references public.holdings(id) on delete cascade,
  -- Match the precision of holdings exactly so backfill is bit-identical.
  quantity              numeric(18,8) not null check (quantity >= 0),
  cost_basis            numeric(14,2) not null check (cost_basis >= 0),
  -- The date the lot was opened. For backfilled lots, this is set to the
  -- holding's created_at::date and `acquired_on_estimated` is true so the
  -- UI can render it as a placeholder until the user replaces it.
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

-- Pin the classification contract into the catalog so it travels with the DB.
comment on table public.holding_lots is
  'Per-acquisition lots that roll up into a holding. sum(quantity) = holdings.quantity and sum(cost_basis) = holdings.cost_basis to the cent. Maintained by migration 0003 and by all future code that mutates this table.';
comment on column public.holding_lots.acquired_on is
  'The date the lot was opened. For lots with acquired_on_estimated = true, this is a placeholder (the holding row''s created_at::date) and MUST NOT be used as input to long-term vs short-term tax classification or any tax-impact estimate. See migration 0003 header for the full contract.';
comment on column public.holding_lots.acquired_on_estimated is
  'true = acquired_on is a placeholder, not user-confirmed. Classification code must check this flag first and either render "needs review" or exclude the lot from LT/ST + tax estimates. Editing acquired_on in the UI sets this flag to false in the same write.';

-- ---------------------------------------------------------------------------
-- 2. Backfill: one lot per existing holding
-- ---------------------------------------------------------------------------
-- Idempotent: skip holdings that already have at least one lot, so re-running
-- the migration on a project that's already migrated is a no-op.

insert into public.holding_lots (
  user_id,
  holding_id,
  quantity,
  cost_basis,
  acquired_on,
  acquired_on_estimated
)
select
  h.user_id,
  h.id,
  h.quantity,
  h.cost_basis,
  h.created_at::date,
  true
from public.holdings h
where not exists (
  select 1 from public.holding_lots hl where hl.holding_id = h.id
);

-- ---------------------------------------------------------------------------
-- 3. Safety check — verify lot sums match the original holding totals
-- ---------------------------------------------------------------------------
-- Compares sum(quantity) and sum(cost_basis) across lots to the holding
-- totals. Any mismatch raises an exception, which rolls back the entire
-- transaction (this migration AND the table creation). Self-hosters never
-- end up in a half-applied state.
--
-- The comparison is done at the holding level (not the global sum) so we
-- catch per-holding bugs even if the global sums happened to coincidentally
-- balance.

do $$
declare
  mismatched_holdings int;
  total_holdings      int;
  total_lots          int;
begin
  select count(*) into total_holdings from public.holdings;
  select count(*) into total_lots     from public.holding_lots;

  select count(*) into mismatched_holdings
  from public.holdings h
  left join (
    select holding_id,
           sum(quantity)   as lot_quantity_sum,
           sum(cost_basis) as lot_cost_basis_sum
    from public.holding_lots
    group by holding_id
  ) l on l.holding_id = h.id
  where -- holding has no lot at all
        l.holding_id is null
        -- or lot sums don't match the holding to the cent
        or l.lot_quantity_sum   != h.quantity
        or l.lot_cost_basis_sum != h.cost_basis;

  if mismatched_holdings > 0 then
    raise exception
      'Tax lot migration safety check failed: % of % holdings have lot sums that do not match the holding total to the cent. Rolling back the entire migration. NO changes have been applied to the database.',
      mismatched_holdings, total_holdings;
  end if;

  raise notice
    'Tax lot migration verified: % holdings, % lots, all sums identical to the cent.',
    total_holdings, total_lots;
end;
$$;

commit;
