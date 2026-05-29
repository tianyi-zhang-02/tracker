import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { deriveCashflow } from '@/lib/derived/cashflow';
import type { TransactionKind } from '@/lib/validation/transactions';

/**
 * GET /api/derived/cashflow
 *   Returns annualized cash-flow aggregates derived from the caller's last
 *   12 months of transactions. The simulator's "use my actual data" prefill
 *   calls this; any future dashboard card that needs the same numbers
 *   should reuse it (the polish phase will consolidate).
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  // 12-month window. We deliberately don't paginate — typical personal-
  // finance volume for a single user fits in well under 2000 rows.
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffIso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;

  const { data, error } = await guard.supabase
    .from('transactions')
    .select('kind, amount, occurred_on')
    .eq('user_id', guard.user.id)
    .gte('occurred_on', cutoffIso)
    .limit(5000);

  if (error) {
    console.warn('[GET /api/derived/cashflow] db error', { code: error.code });
    return apiError.serverError();
  }

  // Compute the actual observation window from the earliest transaction.
  const today = new Date();
  let earliest: Date = today;
  const txs: Array<{ kind: TransactionKind; amount: number }> = [];
  for (const row of data ?? []) {
    const amt = Number(row.amount);
    if (!Number.isFinite(amt)) continue;
    txs.push({ kind: row.kind as TransactionKind, amount: amt });
    const d = new Date(`${row.occurred_on}T00:00:00`);
    if (!Number.isNaN(d.getTime()) && d < earliest) earliest = d;
  }
  const monthsObserved =
    txs.length === 0
      ? 12
      : Math.max(
          1,
          Math.round(
            (today.getFullYear() - earliest.getFullYear()) * 12 +
              (today.getMonth() - earliest.getMonth()),
          ),
        );

  const summary = deriveCashflow(txs, Math.min(12, monthsObserved));
  return NextResponse.json({ summary });
}
