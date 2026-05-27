import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-error';
import { isAllowedOrigin } from '@/lib/security/origin';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { getServerSupabase } from '@/lib/supabase/server';
import { verifyOtpSchema } from '@/lib/validation/auth';

// Rate-limit verify attempts to slow brute-force on the 6-digit code.
const VERIFY_LIMIT = 10;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return apiError.forbidden();

  const ip = getClientIp(request);
  const rl = rateLimit({
    key: `verify-otp:${ip}`,
    limit: VERIFY_LIMIT,
    windowMs: VERIFY_WINDOW_MS,
  });
  if (!rl.allowed) return apiError.tooManyRequests(rl.resetInSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError.badRequest();
  }

  const parsed = verifyOtpSchema.safeParse(body);
  if (!parsed.success) return apiError.badRequest();

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.token,
    type: 'email',
  });

  if (error) {
    // Generic to avoid leaking which step failed.
    return apiError.badRequest('invalid_or_expired_code');
  }

  return NextResponse.json({ ok: true });
}
