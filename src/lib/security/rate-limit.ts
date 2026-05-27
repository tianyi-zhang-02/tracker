import 'server-only';

/**
 * In-memory fixed-window rate limiter, keyed by an arbitrary string (usually
 * an IP). Good enough for a single Vercel serverless instance during the
 * initial deployment; if we ever scale to multiple instances or move to
 * edge runtime, swap this for Upstash Redis with `@upstash/ratelimit`.
 *
 * TODO(scale): replace with Upstash Redis before going production multi-region.
 */

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
};

export function rateLimit(opts: {
  key: string;
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(opts.key);

  if (!bucket || bucket.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + opts.windowMs };
    buckets.set(opts.key, fresh);
    return {
      allowed: true,
      remaining: opts.limit - 1,
      resetInSeconds: Math.ceil(opts.windowMs / 1000),
    };
  }

  bucket.count += 1;
  const remaining = Math.max(0, opts.limit - bucket.count);
  return {
    allowed: bucket.count <= opts.limit,
    remaining,
    resetInSeconds: Math.ceil((bucket.resetAt - now) / 1000),
  };
}

/**
 * Best-effort client IP extraction from a Next request. Trusts standard
 * proxy headers Vercel sets; do not use for anything more sensitive than
 * rate-limiting buckets.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}
