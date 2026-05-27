import { env } from '@/lib/env';

/**
 * CSRF defense for mutating routes. Returns true if the request's Origin
 * header matches our configured app URL. Reject with 403 if false.
 *
 * Same-origin browser requests always send an Origin header on POST/PATCH/
 * DELETE. A missing or mismatched Origin from a non-API client is a strong
 * signal the request is forged.
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    const requestOrigin = new URL(origin).origin;
    const appOrigin = new URL(env.APP_URL).origin;
    return requestOrigin === appOrigin;
  } catch {
    return false;
  }
}
