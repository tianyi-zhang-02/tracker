import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-error';
import { requireUser } from '@/lib/api/require-user';
import { getQuote } from '@/lib/quotes/cache';
import { rateLimit } from '@/lib/security/rate-limit';
import type { Quote } from '@/lib/types/holding';
import { quotesQuerySchema, type AssetType } from '@/lib/validation/holdings';

/**
 * Per-user rate limit on the quotes proxy. Free tier is 25 calls/day total
 * for the whole project — this cap is the safety net against a signed-in
 * user spamming "Refresh prices" and torching the daily budget.
 */
const QUOTES_LIMIT_PER_USER = 60;
const QUOTES_WINDOW_MS = 60 * 60 * 1000; // per hour

/**
 * GET /api/quotes?symbols=AAPL,VOO
 *   - 401 if unauthenticated (auth check runs BEFORE any outbound call)
 *   - Only returns prices for symbols the caller actually owns — this route
 *     deliberately does not act as a generic public-quotes API
 *   - Server-only `getQuote` reads/writes the price_cache table via the
 *     service-role client; the Alpha Vantage key never leaves the server
 */
export async function GET(request: Request) {
  // 1. Auth first — never call upstream for an anonymous request.
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  // 2. Per-user rate limit (cheap belt-and-braces around AV's 25/day quota).
  const rl = rateLimit({
    key: `quotes:${guard.user.id}`,
    limit: QUOTES_LIMIT_PER_USER,
    windowMs: QUOTES_WINDOW_MS,
  });
  if (!rl.allowed) return apiError.tooManyRequests(rl.resetInSeconds);

  // 3. Validate query.
  const url = new URL(request.url);
  const parsed = quotesQuerySchema.safeParse({ symbols: url.searchParams.get('symbols') ?? '' });
  if (!parsed.success) return apiError.badRequest();
  const requested = parsed.data.symbols;

  // 4. Restrict to symbols the user actually owns. This prevents the route
  //    from being abused as a general-purpose quote API by a signed-in user.
  const { data: ownedRows, error: ownedErr } = await guard.supabase
    .from('holdings')
    .select('symbol, asset_type')
    .eq('user_id', guard.user.id)
    .in('symbol', requested);
  if (ownedErr) {
    console.warn('[GET /api/quotes] holdings lookup error', { code: ownedErr.code });
    return apiError.serverError();
  }

  // Pick one asset_type per symbol — if the user holds the same symbol under
  // two types (uncommon but possible), prefer crypto since AV's equity quote
  // function would fail on a crypto symbol.
  const typeBySymbol = new Map<string, AssetType>();
  for (const r of ownedRows ?? []) {
    const cur = typeBySymbol.get(r.symbol);
    const next = r.asset_type as AssetType;
    if (!cur || next === 'crypto') typeBySymbol.set(r.symbol, next);
  }

  // 5. Fetch each owned symbol via the cache (server-only). Symbols the user
  //    doesn't own are returned as `null` so the client can render gracefully.
  const quotes: Record<string, Quote | null> = {};
  for (const sym of requested) {
    const at = typeBySymbol.get(sym);
    if (!at) {
      quotes[sym] = null;
      continue;
    }
    const r = await getQuote(sym, at);
    if (r.ok) {
      quotes[sym] = {
        symbol: r.quote.symbol,
        price: r.quote.price,
        currency: r.quote.currency,
        fetched_at: r.quote.fetched_at,
        cached: r.quote.cached,
      };
    } else {
      quotes[sym] = null;
    }
  }

  return NextResponse.json({ quotes });
}
