import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import type { AccountType } from '@/lib/validation/accounts';

const LIQUID: ReadonlySet<AccountType> = new Set<AccountType>(['cash', 'savings']);
const INVESTED: ReadonlySet<AccountType> = new Set<AccountType>([
  'brokerage',
  'retirement',
  'crypto',
]);

type SnapshotRow = {
  account_id: string;
  balance: string;
  snapshot_date: string;
};
type AccountRow = {
  id: string;
  type: AccountType;
  archived_at: string | null;
};

/**
 * Returns the YYYY-MM-DD of the last day of a given (0-indexed) month.
 */
function monthEnd(year: number, month: number): string {
  // Day 0 of the next month = last day of current month, in local time.
  const d = new Date(year, month + 1, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Net worth at a point in time = sum of (latest snapshot balance per account
 * where snapshot_date <= asOf). Accounts with no snapshot on/before asOf
 * contribute 0.
 */
function netWorthAt(asOf: string, snapshotsByAccount: Map<string, SnapshotRow[]>): number {
  let total = 0;
  for (const snapshots of snapshotsByAccount.values()) {
    let latest: SnapshotRow | undefined;
    for (const s of snapshots) {
      if (s.snapshot_date <= asOf && (!latest || s.snapshot_date > latest.snapshot_date)) {
        latest = s;
      }
    }
    if (latest) total += Number(latest.balance);
  }
  return total;
}

/**
 * GET /api/networth
 *   Snapshot-based net worth aggregator. Returns current totals (liquid /
 *   invested / total / as_of), a delta vs the previous month-end, and the
 *   trailing-12-month month-end series for the chart.
 *
 *   Holdings market value will be added in Step 9 — for now this is pure
 *   account-snapshot math.
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  // Fetch all accounts + all snapshots in one round-trip each (sub-2000 rows
  // for any realistic personal-finance dataset).
  const [{ data: accounts, error: accErr }, { data: snapshots, error: snapErr }] =
    await Promise.all([
      guard.supabase.from('accounts').select('id, type, archived_at').eq('user_id', guard.user.id),
      guard.supabase
        .from('account_snapshots')
        .select('account_id, balance, snapshot_date')
        .eq('user_id', guard.user.id)
        .order('snapshot_date', { ascending: true }),
    ]);

  if (accErr || snapErr) {
    console.warn('[GET /api/networth] db error', {
      accCode: accErr?.code,
      snapCode: snapErr?.code,
    });
    return apiError.serverError();
  }

  const accountRows = (accounts ?? []) as AccountRow[];
  const snapRows = (snapshots ?? []) as SnapshotRow[];

  // Group snapshots by account.
  const byAccount = new Map<string, SnapshotRow[]>();
  for (const s of snapRows) {
    const arr = byAccount.get(s.account_id) ?? [];
    arr.push(s);
    byAccount.set(s.account_id, arr);
  }

  // ---- Current totals (latest snapshot per account, any date) ----
  // We use today as the asOf to get "everything snapshotted so far".
  const now = new Date();
  const today = monthEnd(now.getFullYear(), now.getMonth()); // end of current month — safe upper bound
  // Pull latest snapshot per account up to today.
  const latestByAccount = new Map<string, SnapshotRow>();
  for (const s of snapRows) {
    if (s.snapshot_date > today) continue;
    const prev = latestByAccount.get(s.account_id);
    if (!prev || s.snapshot_date > prev.snapshot_date) {
      latestByAccount.set(s.account_id, s);
    }
  }

  let liquid = 0;
  let invested = 0;
  let total = 0;
  let mostRecentDate: string | null = null;
  for (const acc of accountRows) {
    if (acc.archived_at) continue;
    const latest = latestByAccount.get(acc.id);
    if (!latest) continue;
    const value = Number(latest.balance);
    total += value;
    if (LIQUID.has(acc.type)) liquid += value;
    else if (INVESTED.has(acc.type)) invested += value;
    if (!mostRecentDate || latest.snapshot_date > mostRecentDate) {
      mostRecentDate = latest.snapshot_date;
    }
  }

  // ---- Previous-month comparison ----
  const prevMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const prevMonthEnd = monthEnd(prevMonthYear, prevMonth);
  const prevMonthTotal = netWorthAt(prevMonthEnd, byAccount);

  // ---- Trailing 12 month-end series ----
  const monthly: Array<{ month_end: string; total: number }> = [];
  for (let i = 11; i >= 0; i -= 1) {
    const target = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const me = monthEnd(target.getFullYear(), target.getMonth());
    monthly.push({ month_end: me, total: netWorthAt(me, byAccount) });
  }

  return NextResponse.json({
    current: {
      total,
      liquid,
      invested,
      as_of: mostRecentDate,
    },
    previous_month: {
      as_of: prevMonthEnd,
      total: prevMonthTotal,
      delta: total - prevMonthTotal,
    },
    monthly,
  });
}
