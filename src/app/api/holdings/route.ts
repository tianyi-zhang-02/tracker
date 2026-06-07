import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { isAllowedOrigin } from '@/lib/security/origin';
import type { HoldingWithAccount } from '@/lib/types/holding';
import { createHoldingSchema } from '@/lib/validation/holdings';

const SELECT =
  'id, user_id, account_id, symbol, asset_type, quantity, cost_basis, created_at, ' +
  'account:accounts(id, name, type, currency)';

/**
 * GET /api/holdings — list the caller's holdings joined with their accounts.
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .from('holdings')
    .select(SELECT)
    .eq('user_id', guard.user.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[GET /api/holdings] db error', { code: error.code });
    return apiError.serverError();
  }
  return NextResponse.json({
    holdings: (data ?? []) as unknown as HoldingWithAccount[],
  });
}

/**
 * POST /api/holdings — body { account_id, symbol, asset_type, quantity, cost_basis }.
 */
export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return apiError.forbidden();

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError.badRequest();
  }

  const parsed = createHoldingSchema.safeParse(body);
  if (!parsed.success) return apiError.badRequest();

  // Verify the account belongs to this user (clearer 400 than relying on RLS).
  const { data: account, error: accErr } = await guard.supabase
    .from('accounts')
    .select('id')
    .eq('id', parsed.data.account_id)
    .eq('user_id', guard.user.id)
    .maybeSingle();
  if (accErr) {
    console.warn('[POST /api/holdings] account lookup error', { code: accErr.code });
    return apiError.serverError();
  }
  if (!account) return apiError.badRequest('unknown_account');

  const { data, error } = await guard.supabase
    .from('holdings')
    .insert({
      user_id: guard.user.id,
      account_id: parsed.data.account_id,
      symbol: parsed.data.symbol,
      asset_type: parsed.data.asset_type,
      quantity: parsed.data.quantity,
      cost_basis: parsed.data.cost_basis,
    })
    .select(SELECT)
    .single();

  if (error) {
    console.warn('[POST /api/holdings] db error', { code: error.code });
    return apiError.serverError();
  }

  // Create the initial lot so the holdings ↔ holding_lots invariant
  // holds for the new row. Defaults to today's date with the estimated
  // flag set true if the caller didn't supply an explicit date, so the
  // UI prompts the user to confirm. Setting the flag false here would
  // implicitly assert "the user definitely acquired this today," which
  // is rarely true for a holding being added retroactively.
  const today = new Date().toISOString().slice(0, 10);
  const acquired_on = parsed.data.acquired_on ?? today;
  const acquired_on_estimated =
    parsed.data.acquired_on_estimated ?? (parsed.data.acquired_on === undefined);
  const holdingRow = data as unknown as HoldingWithAccount;
  const { error: lotErr } = await guard.supabase.from('holding_lots').insert({
    user_id: guard.user.id,
    holding_id: holdingRow.id,
    quantity: parsed.data.quantity,
    cost_basis: parsed.data.cost_basis,
    acquired_on,
    acquired_on_estimated,
  });
  if (lotErr) {
    // The holding got created but the lot didn't — the holdings ↔ lots
    // invariant is now violated for this single row. We could try to
    // delete the holding here as a compensating action, but the user
    // would lose their input. Instead surface a 500 and let them retry;
    // a subsequent retry will hit the existing holding (same account +
    // symbol typically) and we'd need to handle duplicates. For now log
    // loudly and accept the inconsistency — a reconciliation job
    // (deferred) can fix it later.
    console.warn('[POST /api/holdings] lot insert error after holding insert', {
      code: lotErr.code,
      holding_id: holdingRow.id,
    });
    return apiError.serverError();
  }

  return NextResponse.json({ holding: holdingRow }, { status: 201 });
}
