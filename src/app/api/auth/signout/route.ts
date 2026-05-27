import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-error';
import { isAllowedOrigin } from '@/lib/security/origin';
import { getServerSupabase } from '@/lib/supabase/server';

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return apiError.forbidden();

  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
