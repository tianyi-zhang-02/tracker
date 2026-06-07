import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { syncHoldingTotals } from '@/lib/holdings/sync-totals';
import { isAllowedOrigin } from '@/lib/security/origin';
import { createLotSchema } from '@/lib/validation/holding-lots';

const idSchema = z.string().uuid();

const LOT_SELECT =
  'id, user_id, holding_id, quantity, cost_basis, acquired_on, acquired_on_estimated, created_at';

/**
 * GET /api/holdings/:id/lots
 *   List every lot belonging to one holding the caller owns.
 *   Ordered by acquired_on ascending so the UI can render a timeline.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const params = await ctx.params;
  if (!idSchema.safeParse(params.id).success) return apiError.badRequest();

  // Ownership check via RLS — only the user's lots come back. Filtering
  // also by user_id on the explicit predicate avoids any RLS surprises
  // if a future policy weakens (defense in depth).
  const { data, error } = await guard.supabase
    .from('holding_lots')
    .select(LOT_SELECT)
    .eq('holding_id', params.id)
    .eq('user_id', guard.user.id)
    .order('acquired_on', { ascending: true });

  if (error) {
    console.warn('[GET /api/holdings/:id/lots] db error', { code: error.code });
    return apiError.serverError();
  }

  return NextResponse.json({ lots: data ?? [] });
}

/**
 * POST /api/holdings/:id/lots
 *   Body: { quantity, cost_basis, acquired_on, acquired_on_estimated? }.
 *   Creates a new lot AND updates the parent holding's `quantity` and
 *   `cost_basis` to the new sum of all lots — preserving the
 *   sum(lots) = holding invariant in the same logical write.
 *
 * Both writes are done in app code (RLS-protected via the SSR client)
 * rather than a real DB transaction because Supabase's JS client doesn't
 * expose multi-statement transactions for RLS-bound writes. If the
 * second write fails after the first succeeds, the caller sees a 500
 * and the safety net is `npm run test:migrations`-style auditing — but
 * the failure mode is INSERT-succeeded-UPDATE-failed which leaves lots
 * present without updated holding totals. That's the inverse of the
 * usual concern (over-counted holdings, not under-counted lots) and is
 * recoverable by recomputing holdings.quantity = sum(lots.quantity).
 * The next phase can add a periodic reconciliation job.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
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
  const parsed = createLotSchema.safeParse(body);
  if (!parsed.success) return apiError.badRequest();

  // Verify the holding exists and is owned by this user — clearer 400 than
  // relying on the lots INSERT's FK to fail.
  const { data: holding, error: hErr } = await guard.supabase
    .from('holdings')
    .select('id, quantity, cost_basis')
    .eq('id', params.id)
    .eq('user_id', guard.user.id)
    .maybeSingle();
  if (hErr) {
    console.warn('[POST /api/holdings/:id/lots] holding lookup error', { code: hErr.code });
    return apiError.serverError();
  }
  if (!holding) return apiError.notFound();

  // 1. Insert the new lot.
  const { data: lot, error: insErr } = await guard.supabase
    .from('holding_lots')
    .insert({
      user_id: guard.user.id,
      holding_id: params.id,
      quantity: parsed.data.quantity,
      cost_basis: parsed.data.cost_basis,
      acquired_on: parsed.data.acquired_on,
      acquired_on_estimated: parsed.data.acquired_on_estimated ?? false,
    })
    .select(LOT_SELECT)
    .single();
  if (insErr || !lot) {
    console.warn('[POST /api/holdings/:id/lots] insert error', { code: insErr?.code });
    return apiError.serverError();
  }

  // 2. Recompute and persist the holding totals from ALL lots (including
  //    the one we just inserted). This is one round-trip and keeps the
  //    invariant authoritatively derived from the lots table — no manual
  //    addition of stale numbers.
  const syncResult = await syncHoldingTotals(guard.supabase, guard.user.id, params.id);
  if (!syncResult.ok) {
    console.warn('[POST /api/holdings/:id/lots] sync error', { code: syncResult.code });
    return apiError.serverError();
  }

  return NextResponse.json({ lot }, { status: 201 });
}
