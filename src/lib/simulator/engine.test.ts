import { describe, it, expect } from 'vitest';

import type { Assumptions } from '@/lib/validation/scenarios';

import { simulate } from './engine';

/**
 * Tests against the documented engine contract. Each test isolates ONE
 * mechanic so a regression points at the specific formula that broke.
 *
 * Math notes for the reviewer:
 *   - All `toBeCloseTo(x, 2)` calls allow 2-decimal slack — appropriate
 *     for compounding floats.
 *   - "Year 0" = `horizonStartYear`, "year 1" = horizonStartYear + 1, etc.
 *   - The start-of-year growth convention means a $100,000 starting
 *     balance with 5% return ends year 0 at $105,000 even if no other
 *     activity happens (no contributions inside their own first year).
 */

function emptyAssumptions(overrides: Partial<Assumptions> = {}): Assumptions {
  return {
    horizonStartYear: 2026,
    horizonEndYear: 2027,
    people: [],
    startingNetWorth: 0,
    startingInvested: 0,
    annualSavingsRatePct: 0,
    effectiveTaxRatePct: 0,
    investment: { returnPct: 0, returnPctLow: 0, returnPctHigh: 0 },
    inflationPct: 0,
    windfalls: [],
    majorExpenses: [],
    recurringAnnualExpenses: 0,
    ...overrides,
  };
}

describe('simulate — pure growth', () => {
  it('compounds startingNetWorth at returnPct with no flows', () => {
    const a = emptyAssumptions({
      startingNetWorth: 100_000,
      investment: { returnPct: 5, returnPctLow: 5, returnPctHigh: 5 },
    });
    const { rows } = simulate(a);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.investmentGrowth).toBeCloseTo(5_000, 2);
    expect(rows[0]!.netWorth).toBeCloseTo(105_000, 2);
    expect(rows[1]!.netWorth).toBeCloseTo(110_250, 2);
  });
});

describe('simulate — inflation', () => {
  it('leaves nominal alone and only deflates real dollars', () => {
    const a = emptyAssumptions({
      startingNetWorth: 100_000,
      inflationPct: 3,
    });
    const { rows } = simulate(a);
    expect(rows[0]!.netWorth).toBe(100_000);
    // Asymmetric convention: real value is measured at END of year, so
    // even row 0 (the first simulation year) shows one period of inflation.
    expect(rows[0]!.netWorthRealTodayDollars).toBeCloseTo(100_000 / 1.03, 2);
    expect(rows[1]!.netWorthRealTodayDollars).toBeCloseTo(100_000 / Math.pow(1.03, 2), 2);
  });

  it('deflates a 10-row horizon by exactly (1+infl)^10 at the last row', () => {
    // The case-3 sanity check: $100k starting, 7% return, 3% inflation,
    // 10-year horizon. Nominal should be 100k * 1.07^10, real should be
    // that divided by 1.03^10.
    const a = emptyAssumptions({
      horizonStartYear: 2026,
      horizonEndYear: 2035,
      startingNetWorth: 100_000,
      investment: { returnPct: 7, returnPctLow: 7, returnPctHigh: 7 },
      inflationPct: 3,
    });
    const { rows } = simulate(a);
    const lastRow = rows[rows.length - 1]!;
    expect(lastRow.netWorth).toBeCloseTo(100_000 * Math.pow(1.07, 10), 0);
    expect(lastRow.netWorthRealTodayDollars).toBeCloseTo(
      (100_000 * Math.pow(1.07, 10)) / Math.pow(1.03, 10),
      0,
    );
  });
});

describe('simulate — career salary curve', () => {
  it('returns the base salary the year a stage starts', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2030,
      people: [
        {
          id: 'p1',
          name: 'A',
          birthYear: 2000,
          careerStages: [{ label: 'X', startAge: 30, baseSalary: 100_000, annualRaisePct: 0 }],
        },
      ],
    });
    expect(simulate(a).rows[0]!.grossIncome).toBe(100_000);
  });

  it('compounds the annual raise', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2032,
      people: [
        {
          id: 'p1',
          name: 'A',
          birthYear: 2000,
          careerStages: [{ label: 'X', startAge: 30, baseSalary: 100_000, annualRaisePct: 5 }],
        },
      ],
    });
    const { rows } = simulate(a);
    expect(rows[0]!.grossIncome).toBeCloseTo(100_000, 2);
    expect(rows[1]!.grossIncome).toBeCloseTo(105_000, 2);
    expect(rows[2]!.grossIncome).toBeCloseTo(110_250, 2);
  });

  it('adds bonus as a multiplier on the (raised) base', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2031,
      people: [
        {
          id: 'p1',
          name: 'A',
          birthYear: 2000,
          careerStages: [
            { label: 'X', startAge: 30, baseSalary: 100_000, annualRaisePct: 5, bonusPct: 10 },
          ],
        },
      ],
    });
    const { rows } = simulate(a);
    // Year 0: 100k * 1.10
    expect(rows[0]!.grossIncome).toBeCloseTo(110_000, 2);
    // Year 1: 100k * 1.05 * 1.10
    expect(rows[1]!.grossIncome).toBeCloseTo(115_500, 2);
  });

  it('switches to the next stage at exactly its startAge', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2036,
      people: [
        {
          id: 'p1',
          name: 'A',
          birthYear: 2000,
          careerStages: [
            { label: 'A', startAge: 30, baseSalary: 100_000, annualRaisePct: 0 },
            { label: 'B', startAge: 35, baseSalary: 200_000, annualRaisePct: 0 },
          ],
        },
      ],
    });
    const { rows } = simulate(a);
    expect(rows[0]!.grossIncome).toBe(100_000); // age 30
    expect(rows[4]!.grossIncome).toBe(100_000); // age 34
    expect(rows[5]!.grossIncome).toBe(200_000); // age 35 — switch
    expect(rows[6]!.grossIncome).toBe(200_000); // age 36
  });

  it('returns 0 income before any stage is active', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2026,
      horizonEndYear: 2027,
      people: [
        {
          id: 'p1',
          name: 'A',
          birthYear: 2000,
          careerStages: [{ label: 'X', startAge: 30, baseSalary: 100_000, annualRaisePct: 0 }],
        },
      ],
    });
    const { rows } = simulate(a);
    expect(rows[0]!.grossIncome).toBe(0); // age 26
    expect(rows[1]!.grossIncome).toBe(0); // age 27
  });

  it('sums income across multiple people', () => {
    const stage = (base: number) => ({
      label: 'X',
      startAge: 30,
      baseSalary: base,
      annualRaisePct: 0,
    });
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2030,
      people: [
        { id: 'p1', name: 'A', birthYear: 2000, careerStages: [stage(100_000)] },
        { id: 'p2', name: 'B', birthYear: 2000, careerStages: [stage(80_000)] },
      ],
    });
    expect(simulate(a).rows[0]!.grossIncome).toBe(180_000);
  });
});

describe('simulate — tax + savings rate', () => {
  it('after-tax = gross * (1 - taxRate)', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2030,
      people: [
        {
          id: 'p1',
          name: 'A',
          birthYear: 2000,
          careerStages: [{ label: 'X', startAge: 30, baseSalary: 100_000, annualRaisePct: 0 }],
        },
      ],
      effectiveTaxRatePct: 25,
      annualSavingsRatePct: 30,
    });
    const { rows } = simulate(a);
    expect(rows[0]!.afterTaxIncome).toBe(75_000);
    expect(rows[0]!.saved).toBeCloseTo(22_500, 2); // 30% of after-tax
  });
});

describe('simulate — windfalls', () => {
  it('lands a one-time windfall in exactly its year', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2032,
      windfalls: [{ label: 'inh', year: 2031, amount: 50_000 }],
    });
    const { rows } = simulate(a);
    expect(rows[0]!.windfalls).toBe(0);
    expect(rows[1]!.windfalls).toBe(50_000);
    expect(rows[2]!.windfalls).toBe(0);
    // Balance grows by exactly the windfall this year (no growth, no income).
    expect(rows[1]!.netWorth - rows[0]!.netWorth).toBeCloseTo(50_000, 2);
  });
});

describe('simulate — major expenses', () => {
  it('one-time expense lands in its year only', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2032,
      startingNetWorth: 200_000,
      majorExpenses: [{ label: 'house', year: 2031, amount: 100_000 }],
    });
    const { rows } = simulate(a);
    expect(rows[0]!.expenses).toBe(0);
    expect(rows[1]!.expenses).toBe(100_000);
    expect(rows[2]!.expenses).toBe(0);
  });

  it('recurring expense spans [startYear, startYear+years)', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2035,
      majorExpenses: [{ label: 'kid', startYear: 2031, annualAmount: 25_000, years: 3 }],
    });
    const { rows } = simulate(a);
    expect(rows[0]!.expenses).toBe(0); // 2030
    expect(rows[1]!.expenses).toBe(25_000); // 2031
    expect(rows[2]!.expenses).toBe(25_000); // 2032
    expect(rows[3]!.expenses).toBe(25_000); // 2033
    expect(rows[4]!.expenses).toBe(0); // 2034
    expect(rows[5]!.expenses).toBe(0); // 2035
  });
});

describe('simulate — recurring expenses inflate', () => {
  it('multiplies recurringAnnualExpenses by (1+inflation)^(i+1)', () => {
    // Coherent end-of-year convention: row i values are nominal at T=i+1,
    // so row 0 already shows one inflation period (input is today-dollars).
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2032,
      recurringAnnualExpenses: 50_000,
      inflationPct: 3,
    });
    const { rows } = simulate(a);
    expect(rows[0]!.expenses).toBeCloseTo(50_000 * 1.03, 2);
    expect(rows[1]!.expenses).toBeCloseTo(50_000 * Math.pow(1.03, 2), 2);
    expect(rows[2]!.expenses).toBeCloseTo(50_000 * Math.pow(1.03, 3), 2);
  });
});

describe('simulate — shortfall draws from balance', () => {
  it('saved goes negative when expenses exceed consumable, and balance drops', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2030,
      startingNetWorth: 100_000,
      recurringAnnualExpenses: 30_000,
      // No income → consumable = 0, shortfall = 30k, saved = -30k.
    });
    const { rows } = simulate(a);
    expect(rows[0]!.expenses).toBe(30_000);
    expect(rows[0]!.saved).toBe(-30_000);
    expect(rows[0]!.netWorth).toBeCloseTo(70_000, 2);
  });
});

describe('simulate — return bands', () => {
  it('low/high use returnPctLow / returnPctHigh respectively', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2030,
      startingNetWorth: 100_000,
      investment: { returnPct: 7, returnPctLow: 4, returnPctHigh: 10 },
    });
    const { rows, low, high } = simulate(a);
    expect(rows[0]!.netWorth).toBeCloseTo(107_000, 2);
    expect(low[0]!.netWorth).toBeCloseTo(104_000, 2);
    expect(high[0]!.netWorth).toBeCloseTo(110_000, 2);
  });
});

describe('simulate — multi-year, multi-mechanic sanity check', () => {
  it('matches a hand-computed two-year run', () => {
    /**
     * - Person born 2000, base $100k, no raise/bonus
     * - Tax 25%, savings 50%, no expenses, no inflation
     * - Returns 5%
     *
     * Year 2030 (yearsElapsed=0):
     *   gross 100k, after-tax 75k, intended-contrib 37.5k, expenses 0
     *   → saved 37.5k. start balance 0 → growth 0 → end 37,500
     * Year 2031 (yearsElapsed=1):
     *   gross 100k, after-tax 75k, intended-contrib 37.5k, expenses 0
     *   → saved 37.5k. start balance 37,500 → growth 37,500*0.05 = 1,875
     *   → end 37,500 + 1,875 + 37,500 = 76,875
     */
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2031,
      people: [
        {
          id: 'p1',
          name: 'A',
          birthYear: 2000,
          careerStages: [{ label: 'X', startAge: 30, baseSalary: 100_000, annualRaisePct: 0 }],
        },
      ],
      effectiveTaxRatePct: 25,
      annualSavingsRatePct: 50,
      investment: { returnPct: 5, returnPctLow: 5, returnPctHigh: 5 },
    });
    const { rows } = simulate(a);
    expect(rows[0]!.netWorth).toBeCloseTo(37_500, 2);
    expect(rows[1]!.investmentGrowth).toBeCloseTo(1_875, 2);
    expect(rows[1]!.netWorth).toBeCloseTo(76_875, 2);
  });
});

describe('simulate — lifestyle creep (flat mode)', () => {
  it('absent lifestyle key behaves identically to flat mode with 0% creep', () => {
    const baseAssumptions = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2032,
      recurringAnnualExpenses: 50_000,
      inflationPct: 3,
    });
    const withoutKey = simulate(baseAssumptions);
    const withZeroCreep = simulate({
      ...baseAssumptions,
      lifestyle: { mode: 'flat', lifestyleCreepPct: 0, creepShareOfRaisePct: 0 },
    });
    for (let i = 0; i < 3; i += 1) {
      expect(withZeroCreep.rows[i]!.expenses).toBeCloseTo(withoutKey.rows[i]!.expenses, 2);
    }
  });

  it('flat mode multiplies the inflation factor by (1+creep)^(i+1)', () => {
    // Hand-computable: $50k base, 3% inflation, 1% lifestyle creep, 3 yrs.
    // Row i expenses = 50000 × 1.03^(i+1) × 1.01^(i+1).
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2032,
      recurringAnnualExpenses: 50_000,
      inflationPct: 3,
      lifestyle: { mode: 'flat', lifestyleCreepPct: 1, creepShareOfRaisePct: 0 },
    });
    const { rows } = simulate(a);
    expect(rows[0]!.expenses).toBeCloseTo(50_000 * 1.03 * 1.01, 2);
    expect(rows[1]!.expenses).toBeCloseTo(50_000 * Math.pow(1.03, 2) * Math.pow(1.01, 2), 2);
    expect(rows[2]!.expenses).toBeCloseTo(50_000 * Math.pow(1.03, 3) * Math.pow(1.01, 3), 2);
  });

  it('flat mode with negative creep models lifestyle DEflation', () => {
    // Belt-and-suspenders: schema allows -50..50, engine should handle it
    // (a household downsizing year-over-year). Expected to compose
    // multiplicatively with inflation.
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2030,
      recurringAnnualExpenses: 50_000,
      inflationPct: 3,
      lifestyle: { mode: 'flat', lifestyleCreepPct: -2, creepShareOfRaisePct: 0 },
    });
    expect(simulate(a).rows[0]!.expenses).toBeCloseTo(50_000 * 1.03 * 0.98, 2);
  });
});

describe('simulate — lifestyle creep (income-scaled mode)', () => {
  it('with no income, incomeScaled reduces to baseline inflation', () => {
    // No people → after-tax income is 0 every year → no raises to absorb.
    // Baseline still inflates year-over-year exactly like flat mode.
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2032,
      recurringAnnualExpenses: 50_000,
      inflationPct: 3,
      lifestyle: { mode: 'incomeScaled', lifestyleCreepPct: 0, creepShareOfRaisePct: 50 },
    });
    const { rows } = simulate(a);
    // baseline_0 = 50_000 × 1.03 = 51_500.
    expect(rows[0]!.expenses).toBeCloseTo(50_000 * 1.03, 2);
    // baseline_1 = 51_500 × 1.03 = 53_045 (no raise add-on, income is 0).
    expect(rows[1]!.expenses).toBeCloseTo(50_000 * 1.03 * 1.03, 2);
    expect(rows[2]!.expenses).toBeCloseTo(50_000 * Math.pow(1.03, 3), 2);
  });

  it('absorbs creepShareOfRaisePct % of an after-tax raise into next year', () => {
    /**
     * Hand-computed walk:
     *   Person: base $100k year 0, raises to $110k year 1 (10% raise).
     *   Tax 0 → after-tax = gross. Inflation 0 (so we isolate the raise math).
     *   creepShare = 50%.
     *
     *   baseline_0 = 50_000 × (1+0) = 50_000      ← year 0
     *   raise = max(0, 110_000 - 100_000) = 10_000
     *   baseline_1 = 50_000 × 1 + 10_000 × 0.50 = 55_000
     */
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2031,
      people: [
        {
          id: 'p1',
          name: 'A',
          birthYear: 2000,
          careerStages: [{ label: 'X', startAge: 30, baseSalary: 100_000, annualRaisePct: 10 }],
        },
      ],
      effectiveTaxRatePct: 0,
      inflationPct: 0,
      recurringAnnualExpenses: 50_000,
      lifestyle: { mode: 'incomeScaled', lifestyleCreepPct: 0, creepShareOfRaisePct: 50 },
    });
    const { rows } = simulate(a);
    expect(rows[0]!.expenses).toBeCloseTo(50_000, 2);
    expect(rows[1]!.expenses).toBeCloseTo(55_000, 2);
  });

  it('clamps a pay cut (income drop) so spending doesn\'t reduce', () => {
    /**
     * Person earns $100k year 0, $80k year 1 (negative raise = pay cut).
     * The raise is clamped to 0, so the baseline still inflates as if no
     * change. This is intentional — lifestyle is sticky downward.
     */
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2031,
      people: [
        {
          id: 'p1',
          name: 'A',
          birthYear: 2000,
          careerStages: [
            { label: 'high', startAge: 30, baseSalary: 100_000, annualRaisePct: 0 },
            { label: 'low', startAge: 31, baseSalary: 80_000, annualRaisePct: 0 },
          ],
        },
      ],
      effectiveTaxRatePct: 0,
      inflationPct: 0,
      recurringAnnualExpenses: 50_000,
      lifestyle: { mode: 'incomeScaled', lifestyleCreepPct: 0, creepShareOfRaisePct: 50 },
    });
    const { rows } = simulate(a);
    // baseline_0 = 50_000. baseline_1 = 50_000 × 1.0 + max(0, 80k - 100k) × 0.5 = 50_000.
    expect(rows[0]!.expenses).toBeCloseTo(50_000, 2);
    expect(rows[1]!.expenses).toBeCloseTo(50_000, 2);
  });
});

describe('simulate — extraAnnualContribution stacks on the savings rate', () => {
  it('adds the extra dollars to saved when expenses are within budget', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2030,
      people: [
        {
          id: 'p1',
          name: 'A',
          birthYear: 2000,
          careerStages: [{ label: 'X', startAge: 30, baseSalary: 100_000, annualRaisePct: 0 }],
        },
      ],
      effectiveTaxRatePct: 25,
      annualSavingsRatePct: 30,
      extraAnnualContribution: 5_000,
    });
    // afterTax = 75k, intended = 22.5k, expenses 0 → saved = 22.5k + 5k.
    expect(simulate(a).rows[0]!.saved).toBeCloseTo(27_500, 2);
  });

  it('still applies during a shortfall (extra is added then shortfall subtracted)', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2030,
      startingNetWorth: 100_000,
      recurringAnnualExpenses: 30_000,
      extraAnnualContribution: 5_000,
      // No income → consumable 0, shortfall 30k. saved = 0 + 5k - 30k = -25k.
    });
    expect(simulate(a).rows[0]!.saved).toBeCloseTo(-25_000, 2);
  });
});

describe('simulate — horizon edge cases', () => {
  it('produces exactly one row when start == end', () => {
    const a = emptyAssumptions({ horizonStartYear: 2030, horizonEndYear: 2030 });
    expect(simulate(a).rows).toHaveLength(1);
  });

  it('reports each person\'s age for the year', () => {
    const a = emptyAssumptions({
      horizonStartYear: 2030,
      horizonEndYear: 2031,
      people: [{ id: 'p1', name: 'A', birthYear: 2000, careerStages: [] }],
    });
    const { rows } = simulate(a);
    expect(rows[0]!.ages.p1).toBe(30);
    expect(rows[1]!.ages.p1).toBe(31);
  });
});
