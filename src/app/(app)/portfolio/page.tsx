import { redirect } from 'next/navigation';

import { getServerSupabase, getAuthedUser } from '@/lib/supabase/server';
import type { Account } from '@/lib/types/account';
import type { HoldingWithAccount } from '@/lib/types/holding';

import PortfolioClient from './portfolio-client';

/**
 * Portfolio page. Server-component reads holdings + active accounts (for
 * the add form). Live prices are fetched client-side via /api/quotes, which
 * is the only route that talks to Alpha Vantage.
 */
export default async function PortfolioPage() {
  const user = await getAuthedUser();
  if (!user) redirect('/login');

  const supabase = await getServerSupabase();

  const [holdingsRes, accountsRes] = await Promise.all([
    supabase
      .from('holdings')
      .select(
        'id, user_id, account_id, symbol, asset_type, quantity, cost_basis, created_at, ' +
          'account:accounts(id, name, type, currency)',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('accounts')
      .select('id, user_id, name, type, currency, archived_at, created_at')
      .eq('user_id', user.id)
      .is('archived_at', null)
      .in('type', ['brokerage', 'retirement', 'crypto', 'other'])
      .order('created_at', { ascending: true }),
  ]);

  if (holdingsRes.error)
    console.warn('[portfolio page] holdings error', { code: holdingsRes.error.code });
  if (accountsRes.error)
    console.warn('[portfolio page] accounts error', { code: accountsRes.error.code });

  const holdings: HoldingWithAccount[] =
    (holdingsRes.data as unknown as HoldingWithAccount[] | null) ?? [];
  const accounts: Account[] = accountsRes.data ?? [];

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 pt-10">
      <header>
        <h1 className="serif-display text-3xl">Portfolio</h1>
        <p className="text-muted mt-2 text-sm">
          Manually-tracked holdings with prices proxied through Alpha Vantage and cached
          server-side.
        </p>
      </header>
      <PortfolioClient initialHoldings={holdings} accounts={accounts} />
    </main>
  );
}
