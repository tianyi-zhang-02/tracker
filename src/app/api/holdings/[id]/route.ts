import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { syncHoldingTotals } from '@/lib/holdings/sync-totals';
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

  const changingQuantity = parsed.data.quantity !== undefined;
  const changingCostBasis = parsed.data.cost_basis !== undefined;

  // If the request is changing quantity or cost_basis, we must keep the
  // holdings ↔ holding_lots invariant intact. For a single-lot holding
  // (the common case — every backfilled holding starts as one lot), we
  // update both rows here. For a multi-lot holding, refuse: the user
  // needs the lot-level UI because we don't know which lot to ascribe
  // the change to.
  let singleLotId: string | null = null;
  if (changingQuantity || changingCostBasis) {
    const { data: lots, error: lotsErr } = await guard.supabase
      .from('holding_lots')
      .select('id')
      .eq('holding_id', params.id)
      .eq('user_id', guard.user.id);
    if (lotsErr) {
      console.warn('[PATCH /api/holdings/:id] lot lookup error', { code: lotsErr.code });
      return apiError.serverError();
    }
    if (!lots || lots.length === 0) {
      // Shouldn't happen — migration 0003 ensured ≥1 lot per holding —
      // but if a self-hoster's DB is in an unexpected state, surface a
      // 409 rather than blindly mirroring a phantom lot.
      return apiError.conflict('holding_has_no_lots');
    }
    if (lots.length > 1) {
      return apiError.conflict('multi_lot_holding_use_lot_endpoints');
    }
    singleLotId = lots[0]!.id;
    if (changingQuantity) patch.quantity = parsed.data.quantity;
    if (changingCostBasis) patch.cost_basis = parsed.data.cost_basis;
  }

  if (Object.keys(patch).length === 0) return apiError.badRequest();

  // Mirror the change onto the single lot first (so syncHoldingTotals
  // would produce identical numbers if it ran). Then update the holding.
  // Both writes need to succeed for the invariant to hold; we accept the
  // same "inverse failure mode" trade-off documented in
  // src/lib/holdings/sync-totals.ts.
  if (singleLotId !== null && (changingQuantity || changingCostBasis)) {
    const lotPatch: Record<string, unknown> = {};
    if (changingQuantity) lotPatch.quantity = parsed.data.quantity;
    if (changingCostBasis) lotPatch.cost_basis = parsed.data.cost_basis;
    const { error: lotUpdErr } = await guard.supabase
      .from('holding_lots')
      .update(lotPatch)
      .eq('id', singleLotId)
      .eq('user_id', guard.user.id);
    if (lotUpdErr) {
      console.warn('[PATCH /api/holdings/:id] lot update error', { code: lotUpdErr.code });
      return apiError.serverError();
    }
  }

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

  // Defensive resync: if the caller went through this branch and any
  // numbers drift due to floating-point, syncHoldingTotals corrects
  // back from sum(lots). Cheap and removes a class of bugs.
  if (changingQuantity || changingCostBasis) {
    const sync = await syncHoldingTotals(guard.supabase, guard.user.id, params.id);
    if (!sync.ok) {
      console.warn('[PATCH /api/holdings/:id] sync error', { code: sync.code });
      return apiError.serverError();
    }
  }

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
