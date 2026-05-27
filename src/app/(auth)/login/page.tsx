import { Suspense } from 'react';

import { getAuthedUser } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

import LoginForm from './login-form';

/**
 * /login is publicly accessible (the proxy excludes it from the auth
 * gate). We still double-check here in case proxy logic regresses — defense
 * in depth.
 */
export default async function LoginPage() {
  const user = await getAuthedUser();
  if (user) redirect('/');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-12">
      <header className="mb-10">
        <h1 className="font-serif text-3xl tracking-tight">tracker</h1>
        <p className="mt-2 text-sm text-zinc-400">Sign in to your personal wealth tracker.</p>
      </header>

      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
