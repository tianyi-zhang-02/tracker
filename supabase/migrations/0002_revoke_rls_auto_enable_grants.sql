-- Step 13 hardening: restrict the public.rls_auto_enable() SECURITY DEFINER
-- function flagged by Supabase Security Advisor (items #1 and #2 in
-- CLAUDE.md's "Known security debt" section).
--
-- A SECURITY DEFINER function exposed to the `anon` and `authenticated`
-- roles is a privilege-escalation surface: a malicious caller can invoke
-- it through PostgREST and the function runs with the definer's grants,
-- not the caller's. The fix is to revoke EXECUTE from public, anon, and
-- authenticated, and grant it only to service_role.
--
-- The function lives in the auto-installed Supabase helpers (it is not
-- declared in schema.sql), so we wrap the REVOKE/GRANT in a DO block
-- that no-ops when the function doesn't exist — that way this migration
-- is safe to apply on a fresh project where the helper was never created.

do $$
declare
  fn_exists boolean;
begin
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
  ) into fn_exists;

  if fn_exists then
    revoke execute on function public.rls_auto_enable() from public;
    revoke execute on function public.rls_auto_enable() from anon;
    revoke execute on function public.rls_auto_enable() from authenticated;
    grant  execute on function public.rls_auto_enable() to service_role;
  end if;
end;
$$;
