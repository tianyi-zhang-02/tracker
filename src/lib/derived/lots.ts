/**
 * Pure, server-safe helpers for the tax-lot classification + hypothetical-
 * sale estimate. No DB access, no I/O — feed them rows and they return
 * numbers and classifications. Unit-tested in `lots.test.ts`.
 *
 * ## Classification contract (per migration 0003 header and ARCHITECTURE.md)
 *
 * Lots with `acquired_on_estimated = true` have a placeholder acquisition
 * date (the holding row's `created_at::date`) — for a user who recently
 * installed tracker this is effectively "today," and using it as the
 * LT/ST cutoff input would mislabel every existing position as
 * short-term.
 *
 * Therefore:
 *   - `classifyLot` returns 'needs_review' when the flag is true. Never
 *     'short_term' or 'long_term'.
 *   - `estimateSale` returns `taxEstimate: null` for needs-review lots.
 *     The UI must render those without a tax number.
 *
 * The 365-day threshold is intentionally exclusive: a lot acquired
 * exactly 365 days ago is still short-term. IRS LT treatment kicks in
 * at "more than one year," which in practice means 366+ days.
 */

export type LotClassification = 'long_term' | 'short_term' | 'needs_review';

export type ClassifiableLot = {
  acquired_on: string; // YYYY-MM-DD
  acquired_on_estimated: boolean;
};

/**
 * Classify a lot at a reference date (defaults to "today" in the calling
 * environment's wall clock). Pass an explicit `today` in tests for
 * determinism.
 *
 * Returns 'needs_review' for lots with `acquired_on_estimated = true`,
 * regardless of the date — never feed the placeholder date into the
 * 365-day rule (see file header for the contract).
 */
export function classifyLot(lot: ClassifiableLot, today: Date = new Date()): LotClassification {
  if (lot.acquired_on_estimated) return 'needs_review';

  // Days between acquired_on (midnight UTC) and today's UTC date.
  const acquired = parseIsoDateUtc(lot.acquired_on);
  if (acquired === null) return 'needs_review'; // malformed date — be safe

  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysHeld = Math.floor((todayUtc - acquired) / 86_400_000);

  return daysHeld > 365 ? 'long_term' : 'short_term';
}

/**
 * Parse 'YYYY-MM-DD' to a UTC midnight timestamp. Returns null on
 * malformed input. Avoids `new Date(iso)` because that interprets
 * date-only strings inconsistently across runtimes.
 */
function parseIsoDateUtc(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d);
}

export type SaleEstimateInput = ClassifiableLot & {
  quantity: number;
  cost_basis: number;
  /** Per-share market price in the same currency as cost_basis. */
  current_price: number;
  /** Effective long-term tax rate, %. 0 = "not set" → no tax estimate. */
  ltTaxRatePct: number;
  /** Effective short-term tax rate, %. 0 = "not set" → no tax estimate. */
  stTaxRatePct: number;
};

export type SaleEstimate = {
  classification: LotClassification;
  /** quantity × current_price. */
  marketValue: number;
  /** marketValue − cost_basis. Negative for losses. */
  unrealizedGain: number;
  /**
   * Estimated tax owed if this lot were sold today, using the user's
   * effective rate for the classification. null when:
   *   - classification is 'needs_review', or
   *   - the relevant rate is 0 (user hasn't set it), or
   *   - the gain is non-positive (no tax on losses or zero-gain sales).
   *
   * Caller MUST NOT render this number as authoritative — it ignores
   * wash sales, lot-selection methods, state-specific surtaxes beyond
   * the user's blended rate, NIIT thresholds, and the loss-harvesting
   * carry-forward. UI must surface the "estimate only" disclaimer.
   */
  taxEstimate: number | null;
};

export function estimateSale(input: SaleEstimateInput, today: Date = new Date()): SaleEstimate {
  const classification = classifyLot(input, today);
  const marketValue = round2(input.quantity * input.current_price);
  const unrealizedGain = round2(marketValue - input.cost_basis);

  let taxEstimate: number | null = null;
  if (classification === 'long_term' && input.ltTaxRatePct > 0 && unrealizedGain > 0) {
    taxEstimate = round2(unrealizedGain * (input.ltTaxRatePct / 100));
  } else if (
    classification === 'short_term' &&
    input.stTaxRatePct > 0 &&
    unrealizedGain > 0
  ) {
    taxEstimate = round2(unrealizedGain * (input.stTaxRatePct / 100));
  }

  return { classification, marketValue, unrealizedGain, taxEstimate };
}

/** Round to two decimals using scaled-integer arithmetic. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
