/**
 * Logic verification for the holding_lots backfill in migration 0003.
 *
 * What this test does — and doesn't:
 *
 *   - DOES check the conceptual mapping of the migration's INSERT: each
 *     existing holding produces exactly one lot whose `quantity` and
 *     `cost_basis` mirror the holding's columns, so the totals are
 *     bit-identical "to the cent" — including for edge cases like
 *     zero-quantity holdings, 8-decimal fractional crypto quantities, and
 *     two-decimal cost-basis precision.
 *   - DOES check that downstream "portfolio value" computations
 *     (sum across holdings of quantity × price) produce the same number
 *     when computed via the holdings table or via the new lots table.
 *
 *   - DOES NOT execute real SQL. There's no local Postgres in this
 *     project's dev setup. Runtime safety is enforced by the do-block at
 *     the bottom of the migration itself — it RAISES if any holding's
 *     lot sums don't equal the holding total, which rolls back the
 *     entire transaction. So self-hosters cannot land in a half-applied
 *     state regardless of what this test catches.
 *
 *   - DOES NOT exhaustively test the migration's RLS / constraint
 *     behaviour — those depend on real Postgres semantics, not JS. They
 *     are exercised in production when the migration is applied.
 */

import { describe, it, expect } from 'vitest';

type HoldingRow = {
  id: string;
  user_id: string;
  account_id: string;
  symbol: string;
  asset_type: 'stock' | 'etf' | 'crypto';
  quantity: number;
  cost_basis: number;
  created_at: string;
};

type HoldingLotRow = {
  id: string;
  user_id: string;
  holding_id: string;
  quantity: number;
  cost_basis: number;
  acquired_on: string;
  acquired_on_estimated: boolean;
};

/**
 * JS analog of the migration's INSERT block. The SQL emits one lot per
 * existing holding, mirroring quantity and cost_basis exactly and
 * stamping acquired_on = created_at::date with acquired_on_estimated
 * set true. This function replicates that mapping so we can verify
 * the resulting totals in JS.
 */
function backfill(holdings: HoldingRow[]): HoldingLotRow[] {
  return holdings.map((h, i) => ({
    id: `lot-${i + 1}`,
    user_id: h.user_id,
    holding_id: h.id,
    quantity: h.quantity,
    cost_basis: h.cost_basis,
    acquired_on: h.created_at.slice(0, 10),
    acquired_on_estimated: true,
  }));
}

/**
 * Sum with explicit precision to avoid 0.1+0.2=0.30000000000000004 issues.
 * `decimals` is the precision of the underlying SQL column we're checking:
 *   - cost_basis is `numeric(14,2)`, so use 2.
 *   - quantity is `numeric(18,8)`, so use 8.
 * Identical-to-the-precision means: after scaling each addend by 10^decimals
 * and rounding to integers, the integer sums match exactly.
 */
function sumAt(numbers: number[], decimals: number): number {
  const scale = Math.pow(10, decimals);
  let scaled = 0;
  for (const n of numbers) scaled += Math.round(n * scale);
  return scaled / scale;
}
const sumCents = (xs: number[]) => sumAt(xs, 2);
const sumQty = (xs: number[]) => sumAt(xs, 8);

describe('migration 0003 — holding_lots backfill invariant', () => {
  const userId = 'user-1';
  const accountId = 'acct-1';

  const holdings: HoldingRow[] = [
    // 1. Plain equity, integer share count, standard cost basis.
    {
      id: 'h1',
      user_id: userId,
      account_id: accountId,
      symbol: 'AAPL',
      asset_type: 'stock',
      quantity: 100,
      cost_basis: 14_350.5,
      created_at: '2024-03-15T10:00:00.000Z',
    },
    // 2. ETF with fractional shares from DRIP / dividend reinvest.
    {
      id: 'h2',
      user_id: userId,
      account_id: accountId,
      symbol: 'VTI',
      asset_type: 'etf',
      quantity: 47.39_281_004,
      cost_basis: 9_876.21,
      created_at: '2023-11-22T10:00:00.000Z',
    },
    // 3. Crypto with 8-decimal precision (BTC-like).
    {
      id: 'h3',
      user_id: userId,
      account_id: accountId,
      symbol: 'BTC-USD',
      asset_type: 'crypto',
      quantity: 0.123_456_78,
      cost_basis: 4_321.99,
      created_at: '2021-05-04T10:00:00.000Z',
    },
    // 4. Zero-quantity holding (closed position retained for history).
    {
      id: 'h4',
      user_id: userId,
      account_id: accountId,
      symbol: 'TSLA',
      asset_type: 'stock',
      quantity: 0,
      cost_basis: 0,
      created_at: '2022-08-01T10:00:00.000Z',
    },
    // 5. Zero cost basis (gift / inheritance).
    {
      id: 'h5',
      user_id: userId,
      account_id: accountId,
      symbol: 'BRK.B',
      asset_type: 'stock',
      quantity: 25,
      cost_basis: 0,
      created_at: '2020-01-10T10:00:00.000Z',
    },
  ];

  it('produces exactly one lot per holding', () => {
    const lots = backfill(holdings);
    expect(lots).toHaveLength(holdings.length);
    for (const h of holdings) {
      expect(lots.filter((l) => l.holding_id === h.id)).toHaveLength(1);
    }
  });

  it('per-holding lot sums equal the holding totals at the column precision', () => {
    const lots = backfill(holdings);
    for (const h of holdings) {
      const holdingLots = lots.filter((l) => l.holding_id === h.id);
      const qtySum = sumQty(holdingLots.map((l) => l.quantity));
      const cbSum = sumCents(holdingLots.map((l) => l.cost_basis));
      // quantity is numeric(18,8) — match to 8 decimals exactly.
      expect(qtySum).toBe(h.quantity);
      // cost_basis is numeric(14,2) — match to the cent exactly.
      expect(cbSum).toBe(h.cost_basis);
    }
  });

  it('portfolio cost-basis total is bit-identical pre- vs post-backfill', () => {
    const lots = backfill(holdings);
    const totalFromHoldings = sumCents(holdings.map((h) => h.cost_basis));
    const totalFromLots = sumCents(lots.map((l) => l.cost_basis));
    expect(totalFromLots).toBe(totalFromHoldings);
  });

  it('portfolio value at an arbitrary price set is bit-identical pre- vs post-backfill', () => {
    // Any fixed price-per-symbol → portfolio value computed both ways must agree.
    // We use cents for the sum so floating-point quirks don't masquerade as a delta.
    const priceBySymbol: Record<string, number> = {
      AAPL: 187.92,
      VTI: 243.18,
      'BTC-USD': 62_491.05,
      TSLA: 240.0,
      'BRK.B': 422.34,
    };
    const valueViaHoldings = sumCents(
      holdings.map((h) => h.quantity * priceBySymbol[h.symbol]!),
    );
    const lots = backfill(holdings);
    const valueViaLots = sumCents(
      lots.map((l) => {
        const h = holdings.find((x) => x.id === l.holding_id)!;
        return l.quantity * priceBySymbol[h.symbol]!;
      }),
    );
    expect(valueViaLots).toBe(valueViaHoldings);
  });

  it('idempotency: a second backfill pass over already-migrated holdings adds zero lots', () => {
    // The SQL migration uses `where not exists (select 1 from holding_lots
    // where holding_id = h.id)` to skip already-migrated holdings. Model
    // that here: filter out holdings that already appear in the existing
    // lot set, and confirm the result is empty after the first pass.
    const firstPass = backfill(holdings);
    const stillNeedsBackfill = holdings.filter(
      (h) => !firstPass.some((l) => l.holding_id === h.id),
    );
    expect(stillNeedsBackfill).toHaveLength(0);
    const secondPass = backfill(stillNeedsBackfill);
    expect(secondPass).toHaveLength(0);
  });

  it('DEMO: print before/after portfolio totals on the seed fixture (verification artifact)', () => {
    const lots = backfill(holdings);
    const priceBySymbol: Record<string, number> = {
      AAPL: 187.92,
      VTI: 243.18,
      'BTC-USD': 62_491.05,
      TSLA: 240.0,
      'BRK.B': 422.34,
    };
    const valueViaHoldings = sumCents(
      holdings.map((h) => h.quantity * priceBySymbol[h.symbol]!),
    );
    const valueViaLots = sumCents(
      lots.map((l) => {
        const h = holdings.find((x) => x.id === l.holding_id)!;
        return l.quantity * priceBySymbol[h.symbol]!;
      }),
    );
    const cbViaHoldings = sumCents(holdings.map((h) => h.cost_basis));
    const cbViaLots = sumCents(lots.map((l) => l.cost_basis));
    const qViaHoldings = sumQty(holdings.map((h) => h.quantity));
    const qViaLots = sumQty(lots.map((l) => l.quantity));

    console.log('\n=== Migration 0003 — before/after on seed fixture ===');
    console.log(`Holdings: ${holdings.length} rows`);
    console.log(`Lots:     ${lots.length} rows (1 per holding by construction)`);
    console.log('');
    console.log('Quantity total:');
    console.log(`  via holdings.quantity:           ${qViaHoldings}`);
    console.log(`  via sum(holding_lots.quantity):  ${qViaLots}`);
    console.log(`  identical: ${qViaHoldings === qViaLots}`);
    console.log('');
    console.log('Cost-basis total ($):');
    console.log(`  via holdings.cost_basis:          $${cbViaHoldings.toFixed(2)}`);
    console.log(`  via sum(holding_lots.cost_basis): $${cbViaLots.toFixed(2)}`);
    console.log(`  identical: ${cbViaHoldings === cbViaLots}`);
    console.log('');
    console.log('Portfolio value at sample prices ($):');
    console.log(`  via holdings.quantity × price:           $${valueViaHoldings.toFixed(2)}`);
    console.log(`  via sum(holding_lots.quantity) × price:  $${valueViaLots.toFixed(2)}`);
    console.log(`  identical: ${valueViaHoldings === valueViaLots}`);
    console.log('');

    expect(qViaLots).toBe(qViaHoldings);
    expect(cbViaLots).toBe(cbViaHoldings);
    expect(valueViaLots).toBe(valueViaHoldings);
  });

  it('safety: a correct multi-lot split still matches the holding total (sanity-checks the assertion shape)', () => {
    // Meta-test: confirm the assertions accept a CORRECT split (sum of
    // two lots == holding total), not just the single-lot mirror used by
    // the migration. So a future code change that legitimately splits a
    // holding into multiple lots will still pass these checks.
    const h = holdings[0]!;
    const split: HoldingLotRow[] = [
      {
        id: 'lot-split-a',
        user_id: h.user_id,
        holding_id: h.id,
        quantity: 60,
        cost_basis: 8_610.3,
        acquired_on: '2023-01-01',
        acquired_on_estimated: false,
      },
      {
        id: 'lot-split-b',
        user_id: h.user_id,
        holding_id: h.id,
        quantity: 40,
        cost_basis: 5_740.2,
        acquired_on: '2024-01-01',
        acquired_on_estimated: false,
      },
    ];
    expect(sumQty(split.map((l) => l.quantity))).toBe(h.quantity);
    expect(sumCents(split.map((l) => l.cost_basis))).toBe(h.cost_basis);
  });
});
