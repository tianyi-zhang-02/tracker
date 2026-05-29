/**
 * Demo file — not really tests, more like reproducible printouts. Each
 * `it.skip(...)` block becomes a `console.log` of the engine's actual
 * output for the three sanity cases requested before sign-off.
 *
 * Run with:
 *   npx vitest run scenarios-demo.test.ts --reporter=verbose
 */

import { describe, it, expect } from 'vitest';

import type { Assumptions } from '@/lib/validation/scenarios';

import { simulate } from './engine';

function base(overrides: Partial<Assumptions> = {}): Assumptions {
  return {
    horizonStartYear: 2026,
    horizonEndYear: 2035, // 10 simulation rows
    people: [],
    startingNetWorth: 0,
    startingInvested: 0,
    annualSavingsRatePct: 0,
    effectiveTaxRatePct: 0,
    investment: { returnPct: 7, returnPctLow: 7, returnPctHigh: 7 },
    inflationPct: 0,
    windfalls: [],
    majorExpenses: [],
    recurringAnnualExpenses: 0,
    ...overrides,
  };
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

describe('demo: three sanity cases', () => {
  it('CASE 1: $100k starting, $0 contrib, 7%, 10 years, 0% inflation', () => {
    const a = base({ startingNetWorth: 100_000 });
    const { rows } = simulate(a);
    const last = rows[rows.length - 1]!;
    console.log('\n=== CASE 1: $100k starting · $0 contrib · 7% · 10 yrs · 0% infl ===');
    console.log('Year | Start bal | Growth | Saved | End balance | Real');
    let startBal = 100_000;
    for (const r of rows) {
      const line =
        `${r.year} | ${fmt(startBal).padStart(9)} | ` +
        `${fmt(r.investmentGrowth).padStart(7)} | ${fmt(r.saved).padStart(6)} | ` +
        `${fmt(r.investedBalance).padStart(11)} | ${fmt(r.netWorthRealTodayDollars).padStart(11)}`;
      console.log(line);
      startBal = r.investedBalance;
    }
    console.log(`\nLast row nominal: $${fmt(last.netWorth)} (expected ≈ $196,715)`);
    console.log(`Last row real:    $${fmt(last.netWorthRealTodayDollars)} (= nominal at 0% infl)\n`);
    expect(last.netWorth).toBeGreaterThan(0);
  });

  it('CASE 2: $0 starting, $1k/mo ($12k/yr) contrib, 7%, 10 years, 0% inflation', () => {
    // Modelled as a person earning exactly $12k with 0% tax + 100% savings
    // rate. End-of-year contribution convention (growth applies first).
    const a = base({
      people: [
        {
          id: 'p1',
          name: 'Saver',
          birthYear: 2000,
          careerStages: [
            { label: 'Saving', startAge: 26, baseSalary: 12_000, annualRaisePct: 0 },
          ],
        },
      ],
      annualSavingsRatePct: 100,
      effectiveTaxRatePct: 0,
    });
    const { rows } = simulate(a);
    const last = rows[rows.length - 1]!;
    console.log('\n=== CASE 2: $0 starting · $12k/yr · 7% · 10 yrs · 0% infl ===');
    console.log(`Last row nominal: $${fmt(last.netWorth)} (expected ≈ $172k ballpark)`);
    // Ordinary annuity FV = 12,000 * ((1.07^10 - 1) / 0.07) ≈ $165,797
    console.log(`Closed-form ordinary annuity:  $${fmt(12_000 * ((Math.pow(1.07, 10) - 1) / 0.07))}`);
    console.log(`Closed-form annuity due (BoY): $${fmt(12_000 * ((Math.pow(1.07, 10) - 1) / 0.07) * 1.07)}\n`);
    expect(last.netWorth).toBeGreaterThan(150_000);
    expect(last.netWorth).toBeLessThan(200_000);
  });

  it('CASE 3: $100k starting, 7% nominal, 3% inflation, 10 years', () => {
    const a = base({
      startingNetWorth: 100_000,
      inflationPct: 3,
    });
    const { rows } = simulate(a);
    const last = rows[rows.length - 1]!;
    console.log('\n=== CASE 3: $100k starting · 7% · 3% infl · 10 yrs ===');
    console.log(`Last row nominal: $${fmt(last.netWorth)} (expected ≈ $196,715)`);
    console.log(`Last row real:    $${fmt(last.netWorthRealTodayDollars)} (expected ≈ $146,000)\n`);
    expect(last.netWorth).toBeCloseTo(196_715, -2);
    expect(last.netWorthRealTodayDollars).toBeCloseTo(146_372, -2);
  });
});
