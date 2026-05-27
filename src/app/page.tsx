import { redirect } from 'next/navigation';

import { getAuthedUser } from '@/lib/supabase/server';

import SignOutButton from './sign-out-button';

/**
 * Placeholder dashboard. Step 4 (layout shell) and Step 7 (net-worth chart)
 * will flesh this out; for now it just proves the auth flow works.
 */
export default async function HomePage() {
  const user = await getAuthedUser();
  // Defense in depth — the proxy already redirects, but never assume.
  if (!user) redirect('/login');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">tracker</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Signed in as <span className="text-zinc-100">{user.email}</span>.
        </p>
      </header>

      <section className="rounded border border-zinc-800 p-4">
        <p className="text-sm text-zinc-400">
          The dashboard, accounts, transactions, and portfolio screens land in subsequent steps. For
          now, sign-in works.
        </p>
      </section>

      <SignOutButton />
    </main>
  );
}
