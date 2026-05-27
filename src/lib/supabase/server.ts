import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Reads/writes session cookies via Next's request-scoped `cookies()`
 * store, so each request gets its own client instance.
 *
 * IMPORTANT: do not cache this client across requests — see
 * https://supabase.com/docs/guides/auth/server-side
 */
export async function getServerSupabase(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  const cookieMethods: CookieMethodsServer = {
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // Server Components cannot set cookies. The proxy refreshes the
        // session for the next request, so swallowing the error here is safe
        // *as long as* proxy.ts is wired up correctly.
      }
    },
  };

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: cookieMethods,
  });
}

/**
 * Returns the authenticated user (verified against the Auth server) or null.
 * Use this — NOT `getSession()` — for any authorization decision.
 */
export async function getAuthedUser() {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
