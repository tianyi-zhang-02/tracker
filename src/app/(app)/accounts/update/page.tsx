import { redirect } from 'next/navigation';

import { getServerSupabase, getAuthedUser } from '@/lib/supabase/server';
import type { Account } from '@/lib/types/account';

import UpdateClient from './update-client';

/**
 * Bulk month-end balance update. Loads active accounts and the most recent
 * snapshot per account so the user can see what the previous balance was
 * while entering the new one.
 */
export default async function BulkUpdatePage() {
  const user = await getAuthedUser();
  if (!user) redirect('/login');

  const supabase = await getServerSupabase();

  const [accountsRes, snapshotsRes] = await Promise.all([
    supabase
      .from('accounts')
      .select('id, user_id, name, type, currency, archived_at, created_at')
      .eq('user_id', user.id)
      .is('archived_at', null)
      .order('created_at', { ascending: true }),
    supabase
      .from('account_snapshots')
      .select('account_id, balance, snapshot_date')
      .eq('user_id', user.id)
      .order('snapshot_date', { ascending: false })
      .limit(1000),
  ]);

  if (accountsRes.error)
    console.warn('[update page] account error', { code: accountsRes.error.code });
  if (snapshotsRes.error)
    console.warn('[update page] snapshot error', { code: snapshotsRes.error.code });

  const accounts: Account[] = accountsRes.data ?? [];

  // Latest snapshot per account, for the "previous balance" hint.
  const latestByAccount = new Map<string, { balance: string; snapshot_date: string }>();
  for (const s of snapshotsRes.data ?? []) {
    const prev = latestByAccount.get(s.account_id);
    if (!prev || s.snapshot_date > prev.snapshot_date) {
      latestByAccount.set(s.account_id, { balance: s.balance, snapshot_date: s.snapshot_date });
    }
  }

  const seeded = accounts.map((a) => ({
    account: a,
    latest: latestByAccount.get(a.id) ?? null,
  }));

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 pt-10">
      <header>
        <h1 className="serif-display text-3xl">Month-end update</h1>
        <p className="text-muted mt-2 text-sm">
          Enter the current balance for each account. Leave a row blank to skip it. Submitting twice
          for the same date overwrites the prior entry.
        </p>
      </header>
      <UpdateClient seeded={seeded} />
    </main>
  );
}
