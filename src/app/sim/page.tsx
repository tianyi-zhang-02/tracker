import { connection } from 'next/server';

import PublicSimulatorClient from './public-simulator-client';

/**
 * Public Wealth Projection Simulator.
 *
 * Server entry for /sim. Intentionally a no-op server component — it does
 * not fetch any data, does not call `requireUser`, does not touch Supabase,
 * does not read any env vars beyond what the framework needs. Its only job
 * is to render the public client, which does all the math in-browser from
 * user-entered assumptions.
 *
 * `await connection()` opts the page into dynamic rendering. Required
 * because the Step 13 CSP injects a per-request nonce via the proxy
 * (`src/proxy.ts`) and Next can only stamp that nonce onto framework
 * scripts during SSR — static-prerendered pages have no request-time
 * header to read, so every script would render without a nonce and be
 * blocked by `script-src 'self' 'nonce-X' 'strict-dynamic'`. The dynamic
 * render cost is trivial here (no data, no I/O) and keeps the strict CSP
 * intact for the public page.
 *
 * Allowlisted in `src/proxy.ts::PUBLIC_PATHS` so the proxy serves it
 * without redirecting to /login. That allowlist entry MUST stay exact-
 * match — never widen it to `/sim*` or add `/sim/` to `PUBLIC_PREFIXES`,
 * because a future `/sim/something-private` would then bypass auth too.
 *
 * No links to or hints about the private app live anywhere on this page.
 * Friends arriving here see a standalone planning tool, not a teaser
 * for tracker.
 */
export default async function PublicSimulatorPage() {
  await connection();
  return <PublicSimulatorClient />;
}
