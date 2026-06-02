import type { Metadata } from 'next';

/**
 * Bare layout for the public simulator at /sim. Intentionally NOT inside the
 * `(app)` route group — that group's layout sets up the bottom nav, the
 * Supabase-backed session refresh check, the toast provider, and other
 * authed chrome. The public page must not see any of that.
 *
 * The only thing this layout does is set page metadata that overrides the
 * root layout's `robots: { index: false }` so the public simulator IS
 * crawlable (in case it's ever shared by URL). Everything else is inherited
 * from the root layout: fonts, globals.css, the service-worker register
 * (which is itself a pure client component with no data dependencies).
 *
 * No imports from `@/lib/supabase/*`, `@/lib/env.server`, `@/lib/derived/*`,
 * or `@/lib/types/scenario`. Anyone touching this file MUST keep that
 * guarantee — the public route is the entire risk surface of Workstream A.
 */
export const metadata: Metadata = {
  title: 'Wealth Projection Simulator',
  description:
    'A planning illustration: project a household net worth over time under your own assumptions. No login, no data stored.',
  // Override the root layout's `index: false`. A shared planning tool
  // should be findable.
  robots: { index: true, follow: true },
};

export default function PublicSimLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      {children}
    </main>
  );
}
