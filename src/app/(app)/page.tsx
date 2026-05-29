import Link from 'next/link';
import { redirect } from 'next/navigation';

import NetWorthChart, { type ChartPoint } from '@/components/charts/net-worth-chart';
import { getServerSupabase, getAuthedUser } from '@/lib/supabase/server';
import type { AccountType } from '@/lib/validation/accounts';

import { KIND_LABELS } from './transactions/transaction-form';
import type { TransactionKind } from '@/lib/validation/transactions';

const LIQUID = new Set<AccountType>(['cash', 'savings']);
const INVESTED = new Set<AccountType>(['brokerage', 'retirement', 'crypto']);

const SIGN_BY_KIND: Record<TransactionKind, '+' | '−' | '↑' | '↓'> = {
  income: '+',
  expense: '−',
  savings_deposit: '↑',
  savings_withdrawal: '↓',
};
const TONE_BY_KIND: Record<TransactionKind, string> = {
  income: 'text-positive',
  expense: 'text-negative',
  savings_deposit: 'text-muted',
  savings_withdrawal: 'text-muted',
};

function monthEnd(year: number, month: number): string {
  const d = new Date(year, month + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function netWorthAt(
  asOf: string,
  byAccount: Map<string, Array<{ balance: string; snapshot_date: string }>>,
) {
  let total = 0;
  for (const list of byAccount.values()) {
    let latest: { balance: string; snapshot_date: string } | undefined;
    for (const s of list) {
      if (s.snapshot_date <= asOf && (!latest || s.snapshot_date > latest.snapshot_date)) {
        latest = s;
      }
    }
    if (latest) total += Number(latest.balance);
  }
  return total;
}

function fmtCurrency(n: number, withCents = false): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: withCents ? 2 : 0,
  }).format(n);
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  }).format(d);
}

export default async function DashboardPage() {
  const user = await getAuthedUser();
  if (!user) redirect('/login');

  const supabase = await getServerSupabase();

  const [accountsRes, snapshotsRes, txsRes] = await Promise.all([
    supabase.from('accounts').select('id, type, archived_at').eq('user_id', user.id),
    supabase
      .from('account_snapshots')
      .select('account_id, balance, snapshot_date')
      .eq('user_id', user.id)
      .order('snapshot_date', { ascending: true }),
    supabase
      .from('transactions')
      .select('id, kind, amount, category, occurred_on, account:accounts(id, name, currency)')
      .eq('user_id', user.id)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  type AccountLite = { id: string; type: AccountType; archived_at: string | null };
  type SnapshotLite = { account_id: string; balance: string; snapshot_date: string };
  type RecentTx = {
    id: string;
    kind: TransactionKind;
    amount: string;
    category: string | null;
    occurred_on: string;
    account: { id: string; name: string; currency: string } | null;
  };

  const accounts: AccountLite[] = (accountsRes.data ?? []) as AccountLite[];
  const snapshots: SnapshotLite[] = (snapshotsRes.data ?? []) as SnapshotLite[];
  const recentTx: RecentTx[] = (txsRes.data ?? []) as unknown as RecentTx[];

  // Group snapshots by account for the time-series math.
  const byAccount = new Map<string, SnapshotLite[]>();
  for (const s of snapshots) {
    const arr = byAccount.get(s.account_id) ?? [];
    arr.push(s);
    byAccount.set(s.account_id, arr);
  }

  const now = new Date();
  const today = monthEnd(now.getFullYear(), now.getMonth());

  // Latest snapshot per account, used for the current at-a-glance numbers.
  const latestByAccount = new Map<string, SnapshotLite>();
  for (const s of snapshots) {
    if (s.snapshot_date > today) continue;
    const prev = latestByAccount.get(s.account_id);
    if (!prev || s.snapshot_date > prev.snapshot_date) {
      latestByAccount.set(s.account_id, s);
    }
  }

  let total = 0;
  let liquid = 0;
  let invested = 0;
  let mostRecent: string | null = null;
  for (const a of accounts) {
    if (a.archived_at) continue;
    const latest = latestByAccount.get(a.id);
    if (!latest) continue;
    const v = Number(latest.balance);
    total += v;
    if (LIQUID.has(a.type)) liquid += v;
    else if (INVESTED.has(a.type)) invested += v;
    if (!mostRecent || latest.snapshot_date > mostRecent) mostRecent = latest.snapshot_date;
  }

  const prevMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const prevMonthEnd = monthEnd(prevMonthYear, prevMonth);
  const prevTotal = netWorthAt(prevMonthEnd, byAccount);
  const delta = total - prevTotal;

  const chart: ChartPoint[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const t = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const me = monthEnd(t.getFullYear(), t.getMonth());
    chart.push({ month_end: me, total: netWorthAt(me, byAccount) });
  }

  const hasAnySnapshots = snapshots.length > 0;
  const deltaSign = delta === 0 ? '' : delta > 0 ? '+' : '−';
  const deltaTone = delta === 0 ? 'text-muted' : delta > 0 ? 'text-positive' : 'text-negative';

  return (
    <main className="flex flex-1 flex-col gap-8 px-6 pt-10">
      <header className="space-y-2">
        <p className="text-muted text-[11px] tracking-[0.2em] uppercase">Net worth</p>
        <p className="serif-display text-foreground nums text-5xl">
          {hasAnySnapshots ? fmtCurrency(total) : '$ —'}
        </p>
        {hasAnySnapshots ? (
          <p className={`nums text-xs ${deltaTone}`}>
            {deltaSign} {fmtCurrency(Math.abs(delta))} this month
          </p>
        ) : (
          <p className="text-muted text-xs">
            Add an account and a snapshot to populate this number.{' '}
            <Link href="/accounts" className="text-foreground underline-offset-4 hover:underline">
              Get started →
            </Link>
          </p>
        )}
      </header>

      <section className="grid grid-cols-2 gap-3">
        <Stat label="Liquid" value={hasAnySnapshots ? fmtCurrency(liquid) : '$ —'} />
        <Stat label="Invested" value={hasAnySnapshots ? fmtCurrency(invested) : '$ —'} />
      </section>

      <section>
        <p className="text-muted mb-2 text-[11px] tracking-[0.2em] uppercase">12-month trend</p>
        <NetWorthChart data={chart} />
      </section>

      <section>
        <div className="mb-2 flex items-end justify-between">
          <p className="text-muted text-[11px] tracking-[0.2em] uppercase">Recent activity</p>
          <Link href="/transactions" className="text-muted hover:text-foreground text-xs">
            View all →
          </Link>
        </div>
        {recentTx.length === 0 ? (
          <div className="border-border text-muted rounded border border-dashed p-4 text-center text-xs">
            No transactions yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recentTx.map((tx) => {
              const amount = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: tx.account?.currency ?? 'USD',
                currencyDisplay: 'narrowSymbol',
                maximumFractionDigits: 2,
              }).format(Number(tx.amount));
              return (
                <li
                  key={tx.id}
                  className="border-border flex items-center justify-between gap-3 rounded border p-3"
                >
                  <div className="min-w-0">
                    <p className={`nums text-sm font-medium ${TONE_BY_KIND[tx.kind]}`}>
                      {SIGN_BY_KIND[tx.kind]} {amount}
                    </p>
                    <p className="text-muted mt-0.5 truncate text-[10px] tracking-wide uppercase">
                      {KIND_LABELS[tx.kind]} · {tx.account?.name ?? 'Unknown'}
                      {tx.category ? ` · ${tx.category}` : ''}
                    </p>
                  </div>
                  <span className="text-muted nums shrink-0 text-[11px]">
                    {fmtDate(tx.occurred_on)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {mostRecent ? (
        <p className="text-muted text-[10px]">As of last snapshot · {fmtDate(mostRecent)}</p>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border rounded border p-4">
      <p className="text-muted text-[10px] tracking-[0.18em] uppercase">{label}</p>
      <p className="serif-display nums mt-2 text-2xl">{value}</p>
    </div>
  );
}
