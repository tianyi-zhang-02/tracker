import { NextResponse, type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';

/**
 * Next.js 16 proxy (the renamed `middleware`). Runs on every request that
 * matches `config.matcher`. Responsibilities:
 *   1. Refresh the Supabase session cookie when needed.
 *   2. Redirect unauthenticated users to /login (except for public paths).
 *   3. Redirect already-authenticated users away from /login.
 *   4. Generate a per-request CSP nonce and attach the Content-Security-Policy
 *      header to HTML responses (Step 13 hardening).
 */

/**
 * Public routes are explicitly allowlisted by exact path to keep the
 * surface area tiny. The send/verify OTP routes must be reachable by
 * unauthenticated users — without them in this list, the proxy would
 * redirect their POST to /login (HTTP 307), the browser's fetch would
 * follow as a POST to /login, get a 200 HTML body back, and the client
 * would *think* it succeeded while Supabase was never called.
 *
 * Do NOT widen this to a `/api/auth/` prefix — that would open any
 * future auth route by default. Add new routes by name on purpose.
 *
 * /api/auth/signout intentionally stays gated; an unauthenticated POST
 * to it has nothing to sign out anyway.
 */
const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/api/auth/send-otp',
  '/api/auth/verify-otp',
  // PWA install endpoints — iOS / Android launchers fetch these without
  // a Supabase session cookie. Redirecting them to /login would break
  // "Add to Home Screen" entirely.
  '/manifest.webmanifest',
  '/sw.js',
  '/icon',
  '/icon1',
  '/icon2',
  '/apple-icon',
  // Public Wealth Projection Simulator. The page itself is pure client-
  // side math (see `src/app/sim/public-simulator-client.tsx`) and its
  // import graph contains NO Supabase / auth / data modules. Exact-match
  // only — do NOT widen this to a `/sim` prefix or add `/sim/` to
  // PUBLIC_PREFIXES, or a future `/sim/something-private` would bypass
  // auth.
  '/sim',
]);
// /auth/confirm is the magic-link callback; unauth users must reach it.
const PUBLIC_PREFIXES = ['/auth/'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Generate a fresh CSP nonce per request. crypto.randomUUID() is cryptographically
 * strong; base64 makes it CSP-token-safe. Length ~24 chars — well above the 16-byte
 * minimum recommended by OWASP.
 */
function generateNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

/**
 * Build the Content-Security-Policy header value.
 *
 * Production policy is strict:
 *   - script-src: 'self' + nonce + 'strict-dynamic' (no 'unsafe-inline', no
 *     'unsafe-eval'). 'strict-dynamic' lets Next.js's nonced framework script
 *     load further chunks without each needing a nonce attribute.
 *   - style-src: 'self' + nonce. Next.js applies the nonce automatically to
 *     style tags it injects during streaming.
 *   - connect-src: 'self' + the Supabase URL (for the SSR client's cookie
 *     refresh round-trips and the /auth/confirm callback). No third-party
 *     analytics endpoints — we don't ship any.
 *   - img-src: 'self' + data: + blob: (data: covers our ImageResponse-generated
 *     PWA icons; blob: covers any future chart-to-image export).
 *   - font-src: 'self' + data: (next/font inlines small font subsets as data:).
 *   - frame-ancestors: 'none' (clickjacking defense — equivalent of X-Frame-
 *     Options DENY; we still set X-Frame-Options in next.config.ts for older UAs).
 *   - object-src 'none', base-uri 'self', form-action 'self': boilerplate hardening.
 *   - upgrade-insecure-requests: forces http→https on any subresource URL that
 *     slipped through.
 *
 * Development relaxes two directives:
 *   - 'unsafe-eval' in script-src: React's dev-mode error overlay uses eval()
 *     to reconstruct server-side stack frames. Stripping it breaks the overlay.
 *   - 'unsafe-inline' in style-src: dev-mode HMR injects inline <style> tags
 *     without nonces. This is dev-only behavior; production styles are nonced.
 *
 * If a future feature needs a new external origin (e.g. an image CDN), add it
 * to the corresponding directive here — never reach for 'unsafe-inline'.
 */
function buildCsp(nonce: string, supabaseOrigin: string): string {
  const isDev = process.env.NODE_ENV === 'development';

  // NOTE on `style-src-attr 'unsafe-inline'`:
  // React + Recharts + our own progress bars and color swatches use the
  // `style={{ ... }}` JSX prop, which renders as an inline `style=` HTML
  // attribute. CSP3 controls those via `style-src-attr`. Without
  // `'unsafe-inline'` here, Recharts SVGs and any width/color computed at
  // render time would be silently stripped, visually breaking the app.
  //
  // This is a narrower escape hatch than `style-src 'unsafe-inline'`:
  //   - style-src-attr applies ONLY to the `style="..."` attribute on
  //     individual elements. It cannot affect document-level <style> or
  //     external stylesheets.
  //   - Inline style attributes cannot execute script and cannot load
  //     external subresources except through `url()` references, which
  //     are bound by the existing `img-src`/`font-src` directives.
  //   - The remaining XSS-via-CSS surface (CSS injection that leaks
  //     keystrokes via background-image: url() to an attacker-controlled
  //     host) is gated by `default-src 'self'`, so an attacker cannot
  //     exfiltrate to an external origin even if they inject a style.
  //
  // Removing this would require migrating every dynamic style attribute
  // to CSS classes (Tailwind utilities for the static ones, CSS custom
  // properties for the computed ones, fork Recharts for the rest). Worth
  // doing later but out of scope for Step 13.
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ''}`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${supabaseOrigin}`.trim(),
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

/**
 * Derive the Supabase origin from NEXT_PUBLIC_SUPABASE_URL for use in CSP
 * connect-src. Returns empty string if the env var is missing or malformed,
 * which leaves connect-src as just 'self' — Supabase calls would then be
 * blocked, surfacing the misconfiguration immediately rather than silently.
 */
function supabaseOrigin(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CSP only applies to documents the browser parses for scripts/styles —
  // API routes return JSON, so attaching it there just bloats response
  // headers. Skip them. Static install endpoints (manifest, sw.js, icons)
  // are also skipped: they're served as their declared MIME types and
  // don't execute scripts.
  const wantsCsp = !(
    pathname.startsWith('/api/') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest'
  );

  if (wantsCsp) {
    const nonce = generateNonce();
    const csp = buildCsp(nonce, supabaseOrigin());

    // Setting these on `request.headers` BEFORE updateSession() runs ensures
    // the renderer sees them — updateSession's NextResponse.next({ request })
    // forwards request headers to the downstream rendering pipeline. Next.js
    // parses `Content-Security-Policy` from the request headers to discover
    // the nonce-{value} token, then auto-applies it to its framework scripts
    // and streaming style tags.
    request.headers.set('x-nonce', nonce);
    request.headers.set('Content-Security-Policy', csp);
  }

  const { response, user } = await updateSession(request);

  // Unauthenticated user trying to reach a protected page → /login
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Preserve where they wanted to go so we can bounce back after auth.
    if (pathname !== '/') {
      url.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(url);
  }

  // Already-authenticated user hitting /login → home
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Mirror the CSP onto the outgoing response so the browser actually enforces
  // it. (The request-header copy is for the renderer; this copy is for the
  // browser.)
  if (wantsCsp) {
    const csp = request.headers.get('Content-Security-Policy');
    if (csp) response.headers.set('Content-Security-Policy', csp);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals, static assets, and the favicon.
  // API routes ARE included on purpose so the session cookie stays fresh.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
