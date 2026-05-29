import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getServerSupabase, getAuthedUser } from '@/lib/supabase/server';
import type { Account } from '@/lib/types/account';
import type { Snapshot } from '@/lib/types/snapshot';

import AccountDetailClient from './account-detail-client';

const TYPE_LABELS = {
  cash: 'Cash',
  savings: 'Savings',
  brokerage: 'Brokerage',
  retirement: 'Retirement',
  crypto: 'Crypto',
  other: 'Other',
} as const;

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getAuthedUser();
  if (!user) redirect('/login');

  const supabase = await getServerSupabase();

  const [accountRes, snapshotsRes, txsRes] = await Promise.all([
    supabase
      .from('accounts')
      .select('id, user_id, name, type, currency, archived_at, created_at')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('account_snapshots')
      .select('id, user_id, account_id, balance, snapshot_date, created_at')
      .eq('user_id', user.id)
      .eq('account_id', id)
      .order('snapshot_date', { ascending: false })
      .limit(60),
    supabase
      .from('transactions')
      .select('id, kind, amount, category, occurred_on')
      .eq('user_id', user.id)
      .eq('account_id', id)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const account = accountRes.data as Account | null;
  if (!account) notFound();

  const snapshots = (snapshotsRes.data ?? []) as Snapshot[];
  const txs = (txsRes.data ?? []) as Array<{
    id: string;
    kind: 'income' | 'expense' | 'savings_deposit' | 'savings_withdrawal';
    amount: string;
    category: string | null;
    occurred_on: string;
  }>;

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 pt-10">
      <header>
        <Link href="/accounts" className="text-muted hover:text-foreground text-xs">
          ← Accounts
        </Link>
        <h1 className="serif-display mt-1 text-3xl">{account.name}</h1>
        <p className="text-muted mt-2 text-[11px] tracking-wide uppercase">
          {TYPE_LABELS[account.type]} · {account.currency}
          {account.archived_at ? ' · Archived' : ''}
        </p>
      </header>

      <AccountDetailClient account={account} initialSnapshots={snapshots} transactions={txs} />
    </main>
  );
}
