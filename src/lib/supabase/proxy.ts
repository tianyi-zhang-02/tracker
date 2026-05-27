import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';

import { env } from '@/lib/env';

/**
 * Refreshes the Supabase session cookie for the incoming request and returns
 * both the (possibly mutated) response and the verified user (or null).
 *
 * Per Supabase SSR guidance, the proxy is the *only* layer that can reliably
 * write refreshed session cookies before the page renders. Without this,
 * expired sessions cause random logouts and JSON parse errors.
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  user: Awaited<
    ReturnType<ReturnType<typeof createServerClient>['auth']['getUser']>
  >['data']['user'];
}> {
  let response = NextResponse.next({ request });

  const cookieMethods: CookieMethodsServer = {
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet) => {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
    },
  };

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: cookieMethods,
  });

  // IMPORTANT: this call must run between createServerClient and any other
  // logic — it's what triggers the cookie refresh. Use getUser (verified
  // against the Auth server), not getSession (trusts the cookie blindly).
  const { data } = await supabase.auth.getUser();

  return { response, user: data.user };
}
