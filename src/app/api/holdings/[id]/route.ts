import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { isAllowedOrigin } from '@/lib/security/origin';
import type { HoldingWithAccount } from '@/lib/types/holding';
import { updateHoldingSchema } from '@/lib/validation/holdings';

const idSchema = z.string().uuid();

const SELECT =
  'id, user_id, account_id, symbol, asset_type, quantity, cost_basis, created_at, ' +
  'account:accounts(id, name, type, currency)';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(request)) return apiError.forbidden();

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const params = await ctx.params;
  if (!idSchema.safeParse(params.id).success) return apiError.badRequest();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError.badRequest();
  }

  const parsed = updateHoldingSchema.safeParse(body);
  if (!parsed.success) return apiError.badRequest();

  // If account_id is changing, verify ownership.
  if (parsed.data.account_id) {
    const { data: account, error: accErr } = await guard.supabase
      .from('accounts')
      .select('id')
      .eq('id', parsed.data.account_id)
      .eq('user_id', guard.user.id)
      .maybeSingle();
    if (accErr) {
      console.warn('[PATCH /api/holdings/:id] account lookup error', { code: accErr.code });
      return apiError.serverError();
    }
    if (!account) return apiError.badRequest('unknown_account');
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.account_id !== undefined) patch.account_id = parsed.data.account_id;
  if (parsed.data.symbol !== undefined) patch.symbol = parsed.data.symbol;
  if (parsed.data.asset_type !== undefined) patch.asset_type = parsed.data.asset_type;
  if (parsed.data.quantity !== undefined) patch.quantity = parsed.data.quantity;
  if (parsed.data.cost_basis !== undefined) patch.cost_basis = parsed.data.cost_basis;

  if (Object.keys(patch).length === 0) return apiError.badRequest();

  const { data, error } = await guard.supabase
    .from('holdings')
    .update(patch)
    .eq('id', params.id)
    .eq('user_id', guard.user.id)
    .select(SELECT)
    .single();

  if (error) {
    console.warn('[PATCH /api/holdings/:id] db error', { code: error.code });
    return apiError.serverError();
  }
  if (!data) return apiError.notFound();

  return NextResponse.json({ holding: data as unknown as HoldingWithAccount });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(request)) return apiError.forbidden();

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const params = await ctx.params;
  if (!idSchema.safeParse(params.id).success) return apiError.badRequest();

  const { error } = await guard.supabase
    .from('holdings')
    .delete()
    .eq('id', params.id)
    .eq('user_id', guard.user.id);

  if (error) {
    console.warn('[DELETE /api/holdings/:id] db error', { code: error.code });
    return apiError.serverError();
  }
  return NextResponse.json({ ok: true });
}
