import 'server-only';

import { getAdminSupabase } from '@/lib/supabase/admin';
import type { AssetType } from '@/lib/validation/holdings';

import { fetchQuote, type FetchedQuote } from './alphavantage';

/**
 * Server-only quote cache backed by the `public.price_cache` table.
 *
 * RLS is enabled on `price_cache` with NO policies — only the service-role
 * client (this module) can read or write it. The browser cannot reach this
 * table even with a leaked anon key.
 *
 * TTL policy:
 *   - Crypto: 1 hour (24/7 market)
 *   - Stock/ETF during market hours (Mon–Fri 13:30–21:00 UTC, roughly
 *     09:30–17:00 ET): 1 hour
 *   - Stock/ETF outside market hours: 24 hours
 *
 * This is what keeps us inside Alpha Vantage's free-tier 25-calls/day box.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type CachedQuote = FetchedQuote & {
  /** ISO timestamp the price was fetched from upstream. */
  fetched_at: string;
  /** True if served from cache without an upstream call this request. */
  cached: boolean;
};

export type QuoteOutcome =
  | { ok: true; quote: CachedQuote }
  | { ok: false; reason: 'unknown_symbol' | 'rate_limited' | 'upstream_error' };

function ttlMs(assetType: AssetType, now: Date): number {
  if (assetType === 'crypto') return HOUR_MS;
  // UTC weekday Mon=1..Fri=5
  const day = now.getUTCDay();
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const marketOpen = day >= 1 && day <= 5 && hour >= 13.5 && hour < 21.0;
  return marketOpen ? HOUR_MS : DAY_MS;
}

/**
 * Get a quote for one symbol. Returns the cached value if fresh; otherwise
 * fetches from Alpha Vantage and upserts the row.
 */
export async function getQuote(symbol: string, assetType: AssetType): Promise<QuoteOutcome> {
  const admin = getAdminSupabase();
  const now = new Date();

  // 1. Look up cache.
  const { data: row, error: readErr } = await admin
    .from('price_cache')
    .select('symbol, price, currency, fetched_at')
    .eq('symbol', symbol)
    .maybeSingle();
  if (readErr) {
    console.warn('[cache] read error', { symbol, code: readErr.code });
    // Fall through to a fresh fetch — cache is best-effort.
  }

  if (row) {
    const ageMs = now.getTime() - new Date(row.fetched_at).getTime();
    if (ageMs < ttlMs(assetType, now)) {
      return {
        ok: true,
        quote: {
          symbol: row.symbol,
          price: Number(row.price),
          currency: row.currency,
          fetched_at: row.fetched_at,
          cached: true,
        },
      };
    }
  }

  // 2. Cache miss or stale → fetch upstream.
  const result = await fetchQuote(symbol, assetType);
  if (!result.ok) {
    // If we have a stale cache row, return it — better than nothing.
    if (row) {
      return {
        ok: true,
        quote: {
          symbol: row.symbol,
          price: Number(row.price),
          currency: row.currency,
          fetched_at: row.fetched_at,
          cached: true,
        },
      };
    }
    return result;
  }

  // 3. Upsert and return.
  const fetchedAt = now.toISOString();
  const { error: upsertErr } = await admin.from('price_cache').upsert({
    symbol: result.quote.symbol,
    price: result.quote.price,
    currency: result.quote.currency,
    fetched_at: fetchedAt,
  });
  if (upsertErr) {
    console.warn('[cache] upsert error', { symbol, code: upsertErr.code });
    // Still return the live value even if we couldn't cache it.
  }

  return {
    ok: true,
    quote: { ...result.quote, fetched_at: fetchedAt, cached: false },
  };
}
