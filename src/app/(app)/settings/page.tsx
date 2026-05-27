import { getAuthedUser } from '@/lib/supabase/server';

import SignOutButton from './sign-out-button';

export default async function SettingsPage() {
  const user = await getAuthedUser();

  return (
    <main className="flex flex-1 flex-col gap-8 px-6 pt-10">
      <header>
        <h1 className="serif-display text-3xl">Settings</h1>
        <p className="text-muted mt-2 text-sm">
          Default currency, inflation assumption, data export, and account deletion will live here.
          Most of it lands in Step 11.
        </p>
      </header>

      <section className="space-y-2">
        <p className="text-muted text-[10px] tracking-[0.18em] uppercase">Account</p>
        <p className="text-sm">{user?.email}</p>
        <SignOutButton />
      </section>
    </main>
  );
}
