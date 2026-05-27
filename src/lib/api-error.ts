import { NextResponse } from 'next/server';

/**
 * Generic, hostile-reader-safe error responses. Never include stack traces,
 * DB error strings, or anything that hints at internal structure.
 *
 * For successful responses, return whatever shape is appropriate at the
 * call site — there's no need to wrap them.
 */
export const apiError = {
  unauthorized: () => NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
  forbidden: () => NextResponse.json({ error: 'forbidden' }, { status: 403 }),
  badRequest: (message = 'invalid request') =>
    NextResponse.json({ error: message }, { status: 400 }),
  notFound: () => NextResponse.json({ error: 'not_found' }, { status: 404 }),
  tooManyRequests: (resetInSeconds: number) =>
    NextResponse.json(
      { error: 'rate_limited', retry_after_seconds: resetInSeconds },
      { status: 429, headers: { 'Retry-After': String(resetInSeconds) } },
    ),
  serverError: () => NextResponse.json({ error: 'internal_error' }, { status: 500 }),
};
