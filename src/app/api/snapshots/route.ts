import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { isAllowedOrigin } from '@/lib/security/origin';
import type { SnapshotWithAccount } from '@/lib/types/snapshot';
import { createSnapshotSchema, snapshotFiltersSchema } from '@/lib/validation/snapshots';

const SELECT =
  'id, user_id, account_id, balance, snapshot_date, created_at, ' +
  'account:accounts(id, name, type, currency)';

/**
 * GET /api/snapshots?account=&from=&to=&limit=
 */
export async function GET(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = snapshotFiltersSchema.safeParse({
    account: url.searchParams.get('account') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) return apiError.badRequest();

  let query = guard.supabase
    .from('account_snapshots')
    .select(SELECT)
    .eq('user_id', guard.user.id)
    .order('snapshot_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.account) query = query.eq('account_id', parsed.data.account);
  if (parsed.data.from) query = query.gte('snapshot_date', parsed.data.from);
  if (parsed.data.to) query = query.lte('snapshot_date', parsed.data.to);

  const { data, error } = await query;
  if (error) {
    console.warn('[GET /api/snapshots] db error', { code: error.code });
    return apiError.serverError();
  }

  return NextResponse.json({
    snapshots: (data ?? []) as unknown as SnapshotWithAccount[],
  });
}

/**
 * POST /api/snapshots
 *   Single snapshot. Upserts on (account_id, snapshot_date) so re-submitting
 *   for the same day overwrites the prior balance.
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

  const parsed = createSnapshotSchema.safeParse(body);
  if (!parsed.success) return apiError.badRequest();

  // Verify account ownership before insert — clearer 400 than a generic 500.
  const { data: account, error: accErr } = await guard.supabase
    .from('accounts')
    .select('id')
    .eq('id', parsed.data.account_id)
    .eq('user_id', guard.user.id)
    .maybeSingle();
  if (accErr) {
    console.warn('[POST /api/snapshots] account lookup error', { code: accErr.code });
    return apiError.serverError();
  }
  if (!account) return apiError.badRequest('unknown_account');

  const { data, error } = await guard.supabase
    .from('account_snapshots')
    .upsert(
      {
        user_id: guard.user.id,
        account_id: parsed.data.account_id,
        balance: parsed.data.balance,
        snapshot_date: parsed.data.snapshot_date,
      },
      { onConflict: 'account_id,snapshot_date' },
    )
    .select(SELECT)
    .single();

  if (error) {
    console.warn('[POST /api/snapshots] db error', { code: error.code });
    return apiError.serverError();
  }

  return NextResponse.json({ snapshot: data as unknown as SnapshotWithAccount }, { status: 201 });
}
