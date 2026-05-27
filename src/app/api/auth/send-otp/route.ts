import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-error';
import { isAllowedOrigin } from '@/lib/security/origin';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { getServerSupabase } from '@/lib/supabase/server';
import { sendOtpSchema } from '@/lib/validation/auth';

// Rate-limit: 5 send-OTP requests per IP per hour. Tight by design — sending
// emails is expensive and a cheap abuse vector.
const SEND_OTP_LIMIT = 5;
const SEND_OTP_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return apiError.forbidden();

  const ip = getClientIp(request);
  const rl = rateLimit({
    key: `send-otp:${ip}`,
    limit: SEND_OTP_LIMIT,
    windowMs: SEND_OTP_WINDOW_MS,
  });
  if (!rl.allowed) return apiError.tooManyRequests(rl.resetInSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError.badRequest();
  }

  const parsed = sendOtpSchema.safeParse(body);
  if (!parsed.success) return apiError.badRequest();

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      // Lets new emails sign in (creates the auth.users row on first verify).
      shouldCreateUser: true,
    },
  });

  // We deliberately return the same shape whether or not the email exists or
  // Supabase rejected the request. Don't leak enumeration signals.
  if (error) {
    // Log on the server only.
    console.warn('[send-otp] supabase error', { code: error.code });
  }

  return NextResponse.json({ ok: true });
}
