import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { getServerSupabase } from '@/lib/supabase/server';

/**
 * Handles the magic-link click in the OTP email. Supabase sends both a
 * 6-digit code AND a clickable link; this route processes the link. The
 * code path is `/api/auth/verify-otp`.
 *
 * Configure the Supabase email template's link to point at:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/';

  // Only allow relative redirects to prevent open-redirect abuse.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', origin));
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    return NextResponse.redirect(new URL('/login?error=invalid_or_expired_link', origin));
  }

  return NextResponse.redirect(new URL(safeNext, origin));
}
