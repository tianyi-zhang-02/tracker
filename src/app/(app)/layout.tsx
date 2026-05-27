import { redirect } from 'next/navigation';

import BottomNav from '@/components/layout/bottom-nav';
import { getAuthedUser } from '@/lib/supabase/server';

/**
 * Layout for all authenticated app pages. The proxy redirects unauth users
 * before they reach this layout, but the explicit check is defense in depth.
 *
 * Pages inside this group get the bottom nav and a bottom padding to clear
 * it; pages outside (e.g. /login) render without the nav.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser();
  if (!user) redirect('/login');

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col pb-28">
      {children}
      <BottomNav />
    </div>
  );
}
