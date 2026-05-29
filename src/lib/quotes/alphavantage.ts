import 'server-only';

import { serverEnv } from '@/lib/env.server';
import type { AssetType } from '@/lib/validation/holdings';

/**
 * Thin wrapper over Alpha Vantage. **Server-only** — never import from a
 * client component. The API key lives in serverEnv, which itself imports
 * `server-only`, so accidental client imports fail at build time.
 *
 * Free tier limits: 25 calls/day, 5/min. Aggressive caching upstream of
 * this module (see cache.ts) is what keeps us inside that envelope.
 */

const BASE_URL = 'https://www.alphavantage.co/query';

export type FetchedQuote = {
  symbol: string;
  price: number;
  currency: string;
};

export type FetchResult =
  | { ok: true; quote: FetchedQuote }
  | { ok: false; reason: 'unknown_symbol' | 'rate_limited' | 'upstream_error' };

/**
 * Fetch a current quote from Alpha Vantage. The caller (cache.ts) decides
 * when to invoke this — this function is just the network round-trip and
 * the response parser.
 */
export async function fetchQuote(symbol: string, assetType: AssetType): Promise<FetchResult> {
  const key = serverEnv.ALPHAVANTAGE_API_KEY; // throws if missing — desired
  const url = buildUrl(symbol, assetType, key);

  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    console.warn('[alphavantage] network error', { symbol, message: (err as Error).message });
    return { ok: false, reason: 'upstream_error' };
  }

  if (!res.ok) {
    console.warn('[alphavantage] non-200', { symbol, status: res.status });
    return { ok: false, reason: 'upstream_error' };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'upstream_error' };
  }

  // AV signals rate-limit / quota with either a "Note" or "Information" key.
  // We never let those reach the client untransformed.
  if (typeof body === 'object' && body !== null) {
    const obj = body as Record<string, unknown>;
    if ('Note' in obj || 'Information' in obj) {
      console.warn('[alphavantage] rate-limited or quota exceeded', { symbol });
      return { ok: false, reason: 'rate_limited' };
    }
  }

  return assetType === 'crypto' ? parseCrypto(body, symbol) : parseEquity(body, symbol);
}

function buildUrl(symbol: string, assetType: AssetType, key: string): string {
  const params = new URLSearchParams();
  if (assetType === 'crypto') {
    // Allow "BTC-USD" or "BTC" — split on '-' if present, default quote=USD.
    const [from, to] = symbol.includes('-') ? symbol.split('-', 2) : [symbol, 'USD'];
    params.set('function', 'CURRENCY_EXCHANGE_RATE');
    params.set('from_currency', from ?? symbol);
    params.set('to_currency', to ?? 'USD');
  } else {
    params.set('function', 'GLOBAL_QUOTE');
    params.set('symbol', symbol);
  }
  params.set('apikey', key);
  return `${BASE_URL}?${params.toString()}`;
}

function parseEquity(body: unknown, symbol: string): FetchResult {
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'upstream_error' };
  const quote = (body as Record<string, unknown>)['Global Quote'];
  if (typeof quote !== 'object' || quote === null) return { ok: false, reason: 'upstream_error' };
  const priceRaw = (quote as Record<string, unknown>)['05. price'];
  if (typeof priceRaw !== 'string' || priceRaw.length === 0) {
    // Empty object → AV's signal for "symbol not found".
    return { ok: false, reason: 'unknown_symbol' };
  }
  const price = Number(priceRaw);
  if (!Number.isFinite(price)) return { ok: false, reason: 'upstream_error' };
  return { ok: true, quote: { symbol, price, currency: 'USD' } };
}

function parseCrypto(body: unknown, symbol: string): FetchResult {
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'upstream_error' };
  const rate = (body as Record<string, unknown>)['Realtime Currency Exchange Rate'];
  if (typeof rate !== 'object' || rate === null) return { ok: false, reason: 'unknown_symbol' };
  const priceRaw = (rate as Record<string, unknown>)['5. Exchange Rate'];
  const quoteCcy = (rate as Record<string, unknown>)['4. To_Currency Code'];
  if (typeof priceRaw !== 'string') return { ok: false, reason: 'unknown_symbol' };
  const price = Number(priceRaw);
  if (!Number.isFinite(price)) return { ok: false, reason: 'upstream_error' };
  return {
    ok: true,
    quote: { symbol, price, currency: typeof quoteCcy === 'string' ? quoteCcy : 'USD' },
  };
}
