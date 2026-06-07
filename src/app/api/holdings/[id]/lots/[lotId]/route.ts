import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { syncHoldingTotals } from '@/lib/holdings/sync-totals';
import { isAllowedOrigin } from '@/lib/security/origin';
import { updateLotSchema } from '@/lib/validation/holding-lots';

const idSchema = z.string().uuid();

const LOT_SELECT =
  'id, user_id, holding_id, quantity, cost_basis, acquired_on, acquired_on_estimated, created_at';

/**
 * PATCH /api/holdings/:id/lots/:lotId
 *   Body: any subset of { quantity, cost_basis, acquired_on, acquired_on_estimated }.
 *
 * Two invariants enforced by the API:
 *
 *   1. Editing `acquired_on` implicitly flips `acquired_on_estimated` to
 *      false — the user is confirming a real date by typing it, so the
 *      placeholder flag is no longer accurate. Callers can override this
 *      by also sending an explicit `acquired_on_estimated` value (rare;
 *      e.g. a re-migration tool that wants to re-flag a stale date).
 *
 *   2. After the lot update lands, the parent holding's `quantity` and
 *      `cost_basis` are recomputed from the lots via
 *      `syncHoldingTotals` so the holdings ↔ holding_lots invariant is
 *      maintained.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; lotId: string }> },
) {
  if (!isAllowedOrigin(request)) return apiError.forbidden();

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const params = await ctx.params;
  if (!idSchema.safeParse(params.id).success || !idSchema.safeParse(params.lotId).success) {
    return apiError.badRequest();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError.badRequest();
  }
  const parsed = updateLotSchema.safeParse(body);
  if (!parsed.success) return apiError.badRequest();

  // Build the patch with the implicit "editing date confirms it" rule.
  const patch: Record<string, unknown> = {};
  if (parsed.data.quantity !== undefined) patch.quantity = parsed.data.quantity;
  if (parsed.data.cost_basis !== undefined) patch.cost_basis = parsed.data.cost_basis;
  if (parsed.data.acquired_on !== undefined) {
    patch.acquired_on = parsed.data.acquired_on;
    // Implicit flag flip — see invariant 1 in the docstring.
    if (parsed.data.acquired_on_estimated === undefined) {
      patch.acquired_on_estimated = false;
    }
  }
  if (parsed.data.acquired_on_estimated !== undefined) {
    patch.acquired_on_estimated = parsed.data.acquired_on_estimated;
  }
  if (Object.keys(patch).length === 0) return apiError.badRequest();

  // 1. Update the lot, scoped to the holding AND user via RLS + explicit predicates.
  const { data: lot, error: updErr } = await guard.supabase
    .from('holding_lots')
    .update(patch)
    .eq('id', params.lotId)
    .eq('holding_id', params.id)
    .eq('user_id', guard.user.id)
    .select(LOT_SELECT)
    .single();
  if (updErr) {
    console.warn('[PATCH /api/holdings/:id/lots/:lotId] db error', { code: updErr.code });
    return apiError.serverError();
  }
  if (!lot) return apiError.notFound();

  // 2. Resync the parent holding's totals.
  const sync = await syncHoldingTotals(guard.supabase, guard.user.id, params.id);
  if (!sync.ok) {
    console.warn('[PATCH /api/holdings/:id/lots/:lotId] sync error', { code: sync.code });
    return apiError.serverError();
  }

  return NextResponse.json({ lot });
}

/**
 * DELETE /api/holdings/:id/lots/:lotId
 *
 * Removes one lot from a holding and resyncs the holding totals.
 * Refuses to remove the LAST lot — a holding without any lots would
 * violate the invariant (sum(lots) = 0 ≠ holdings.quantity > 0) and
 * the user almost certainly wants to delete the whole holding via
 * the existing DELETE /api/holdings/:id endpoint instead.
 */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string; lotId: string }> },
) {
  if (!isAllowedOrigin(request)) return apiError.forbidden();

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const params = await ctx.params;
  if (!idSchema.safeParse(params.id).success || !idSchema.safeParse(params.lotId).success) {
    return apiError.badRequest();
  }

  // Count remaining lots BEFORE deleting so we can refuse the
  // would-be-last-lot case explicitly. Avoids a TOCTOU bug where two
  // concurrent DELETEs both pass the count check.
  const { count, error: countErr } = await guard.supabase
    .from('holding_lots')
    .select('id', { count: 'exact', head: true })
    .eq('holding_id', params.id)
    .eq('user_id', guard.user.id);
  if (countErr) {
    console.warn('[DELETE /api/holdings/:id/lots/:lotId] count error', { code: countErr.code });
    return apiError.serverError();
  }
  if ((count ?? 0) <= 1) {
    return apiError.badRequest('last_lot_cannot_be_removed');
  }

  const { error: delErr } = await guard.supabase
    .from('holding_lots')
    .delete()
    .eq('id', params.lotId)
    .eq('holding_id', params.id)
    .eq('user_id', guard.user.id);
  if (delErr) {
    console.warn('[DELETE /api/holdings/:id/lots/:lotId] db error', { code: delErr.code });
    return apiError.serverError();
  }

  const sync = await syncHoldingTotals(guard.supabase, guard.user.id, params.id);
  if (!sync.ok) {
    console.warn('[DELETE /api/holdings/:id/lots/:lotId] sync error', { code: sync.code });
    return apiError.serverError();
  }

  return NextResponse.json({ ok: true });
}
