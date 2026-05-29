import type { AssetType } from '@/lib/validation/holdings';

/**
 * Database row shape for `public.holdings`.
 */
export type Holding = {
  id: string;
  user_id: string;
  account_id: string;
  symbol: string;
  asset_type: AssetType;
  /** numeric(18,8) — Supabase serializes to a string. */
  quantity: string;
  /** numeric(14,2) — total cost paid, not per-share. */
  cost_basis: string;
  created_at: string;
};

export type HoldingWithAccount = Holding & {
  account: { id: string; name: string; type: string; currency: string } | null;
};

export type Quote = {
  symbol: string;
  /** Price in the symbol's quote currency (USD for AV's free tier). */
  price: number;
  currency: string;
  /** Server time when the price was last fetched from upstream. */
  fetched_at: string;
  /** True if served from cache without an upstream call this request. */
  cached: boolean;
};
