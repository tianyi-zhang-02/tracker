import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { isAllowedOrigin } from '@/lib/security/origin';
import { bulkSnapshotSchema } from '@/lib/validation/snapshots';

/**
 * POST /api/snapshots/bulk
 *   Body: { snapshot_date, entries: [{ account_id, balance }, ...] }
 *   Used by the month-end update flow. Upserts on (account_id, snapshot_date)
 *   so re-runs for the same date overwrite prior values.
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

  const parsed = bulkSnapshotSchema.safeParse(body);
  if (!parsed.success) return apiError.badRequest();

  // Verify every account belongs to the caller before any writes.
  const ids = Array.from(new Set(parsed.data.entries.map((e) => e.account_id)));
  const { data: owned, error: ownErr } = await guard.supabase
    .from('accounts')
    .select('id')
    .eq('user_id', guard.user.id)
    .in('id', ids);
  if (ownErr) {
    console.warn('[POST /api/snapshots/bulk] account lookup error', { code: ownErr.code });
    return apiError.serverError();
  }
  const ownedSet = new Set((owned ?? []).map((a) => a.id));
  if (ownedSet.size !== ids.length) return apiError.badRequest('unknown_account');

  const rows = parsed.data.entries.map((e) => ({
    user_id: guard.user.id,
    account_id: e.account_id,
    balance: e.balance,
    snapshot_date: parsed.data.snapshot_date,
  }));

  const { data, error } = await guard.supabase
    .from('account_snapshots')
    .upsert(rows, { onConflict: 'account_id,snapshot_date' })
    .select('id, account_id, balance, snapshot_date');

  if (error) {
    console.warn('[POST /api/snapshots/bulk] db error', { code: error.code });
    return apiError.serverError();
  }

  return NextResponse.json({ snapshots: data ?? [], count: (data ?? []).length });
}
