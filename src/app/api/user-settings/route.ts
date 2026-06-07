import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { isAllowedOrigin } from '@/lib/security/origin';
import {
  updateUserSettingsSchema,
  type UserSettings,
} from '@/lib/validation/user-settings';

const SELECT =
  'user_id, default_currency, inflation_assumption, effective_lt_tax_rate_pct, effective_st_tax_rate_pct, created_at, updated_at';

/**
 * GET /api/user-settings
 *   Returns the caller's user_settings row. If the row doesn't exist
 *   (first read), it's created lazily with all default values so the
 *   UI doesn't have to special-case a missing row.
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  // First attempt — the common case.
  const { data, error } = await guard.supabase
    .from('user_settings')
    .select(SELECT)
    .eq('user_id', guard.user.id)
    .maybeSingle();
  if (error) {
    console.warn('[GET /api/user-settings] select error', { code: error.code });
    return apiError.serverError();
  }
  if (data) return NextResponse.json({ settings: data as unknown as UserSettings });

  // Lazy create with defaults. The migration set CHECK + DEFAULT for
  // every column so we don't need to supply them explicitly.
  const { data: created, error: insErr } = await guard.supabase
    .from('user_settings')
    .insert({ user_id: guard.user.id })
    .select(SELECT)
    .single();
  if (insErr) {
    console.warn('[GET /api/user-settings] insert error', { code: insErr.code });
    return apiError.serverError();
  }
  return NextResponse.json({ settings: created as unknown as UserSettings });
}

/**
 * PATCH /api/user-settings
 *   Body: any subset of { default_currency, inflation_assumption,
 *                         effective_lt_tax_rate_pct, effective_st_tax_rate_pct }.
 *   Lazy-creates the row if it doesn't exist (same as GET).
 */
export async function PATCH(request: Request) {
  if (!isAllowedOrigin(request)) return apiError.forbidden();

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError.badRequest();
  }
  const parsed = updateUserSettingsSchema.safeParse(body);
  if (!parsed.success) return apiError.badRequest();

  // Make sure a row exists (Supabase doesn't have upsert-and-update-only-fields).
  const { error: ensureErr } = await guard.supabase
    .from('user_settings')
    .upsert(
      { user_id: guard.user.id, ...parsed.data, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (ensureErr) {
    console.warn('[PATCH /api/user-settings] upsert error', { code: ensureErr.code });
    return apiError.serverError();
  }

  // Read back the canonical row to return.
  const { data, error: selErr } = await guard.supabase
    .from('user_settings')
    .select(SELECT)
    .eq('user_id', guard.user.id)
    .single();
  if (selErr || !data) {
    console.warn('[PATCH /api/user-settings] readback error', { code: selErr?.code });
    return apiError.serverError();
  }
  return NextResponse.json({ settings: data as unknown as UserSettings });
}
