-- Phase 4 part 2 — Add effective LT/ST tax rates to user_settings.
--
-- Additive and forward-only. New columns default to 0, which the UI
-- interprets as "user hasn't entered a rate yet — don't show tax
-- estimates." This means the migration is safe on a populated DB
-- (existing rows just get the default) and the application behavior
-- doesn't change for users who haven't opted in.
--
-- Range and precision match the existing inflation_assumption column.
-- 0–80% covers the realistic combined federal+state ordinary-income
-- bracket without allowing nonsense like 150%. numeric(5,2) is two
-- decimals of precision, plenty for a percentage.

begin;

alter table public.user_settings
  add column if not exists effective_lt_tax_rate_pct
    numeric(5,2) not null default 0
    check (effective_lt_tax_rate_pct >= 0 and effective_lt_tax_rate_pct <= 80);

alter table public.user_settings
  add column if not exists effective_st_tax_rate_pct
    numeric(5,2) not null default 0
    check (effective_st_tax_rate_pct >= 0 and effective_st_tax_rate_pct <= 80);

comment on column public.user_settings.effective_lt_tax_rate_pct is
  'Effective long-term capital-gains tax rate (combined federal + state + NIIT, user-entered). Used only for the hypothetical-sale estimate. 0 = not set; UI hides tax estimates until both rates are positive.';
comment on column public.user_settings.effective_st_tax_rate_pct is
  'Effective short-term capital-gains tax rate (combined ordinary-income rate, user-entered). Used only for the hypothetical-sale estimate. 0 = not set; UI hides tax estimates until both rates are positive.';

commit;
