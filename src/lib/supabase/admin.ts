import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';
import { serverEnv } from '@/lib/env.server';

/**
 * Service-role Supabase client. Bypasses RLS — use only for trusted server
 * operations (e.g. writing to the price_cache table from the /api/quotes
 * route). NEVER use this client to act on behalf of a user without first
 * verifying their session with `getAuthedUser()` and scoping all queries to
 * `user_id = <verified id>`.
 */
let _admin: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(env.SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return _admin;
}
