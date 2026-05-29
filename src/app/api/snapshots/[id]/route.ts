import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { isAllowedOrigin } from '@/lib/security/origin';

const idSchema = z.string().uuid();

/**
 * DELETE /api/snapshots/:id
 *   Hard delete — snapshots are correctable history, and the user is the
 *   only person who can have entered them.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(request)) return apiError.forbidden();

  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const params = await ctx.params;
  if (!idSchema.safeParse(params.id).success) return apiError.badRequest();

  const { error } = await guard.supabase
    .from('account_snapshots')
    .delete()
    .eq('id', params.id)
    .eq('user_id', guard.user.id);

  if (error) {
    console.warn('[DELETE /api/snapshots/:id] db error', { code: error.code });
    return apiError.serverError();
  }

  return NextResponse.json({ ok: true });
}
