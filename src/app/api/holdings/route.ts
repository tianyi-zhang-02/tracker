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

  return NextResponse.json({ holding: data as unknown as HoldingWithAccount }, { status: 201 });
}
