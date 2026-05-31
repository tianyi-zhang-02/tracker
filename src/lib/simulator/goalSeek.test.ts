import { describe, it, expect } from 'vitest';

import type { Assumptions } from '@/lib/validation/scenarios';

import { simulate } from './engine';
import { netWorthAtAge, solveGoalSeek } from './goalSeek';

/**
 * Round-trip is the correctness guarantee:
 *
 *   solve a lever → get value X → set that value on the scenario →
 *   re-simulate → the engine's net worth at target age must equal target ± tolerance.
 *
 * If round-trip holds, the solver's answer is correct **by the engine's
 * definition**, regardless of whether the engine's mathematical
 * assumptions are themselves "right." That's the design decision: lean
 * on the verified engine instead of deriving fresh closed forms.
 */

function baseScenario(overrides: Partial<Assumptions> = {}): Assumptions {
  return {
    horizonStartYear: 2030,
    horizonEndYear: 2050,
    people: [
      {
        id: 'p1',
        name: 'A',
        birthYear: 2000,
        careerStages: [{ label: 'X', startAge: 30, baseSalary: 100_000, annualRaisePct: 0 }],
      },
    ],
    startingNetWorth: 50_000,
    startingInvested: 50_000,
    annualSavingsRatePct: 20,
    effectiveTaxRatePct: 25,
    investment: { returnPct: 7, returnPctLow: 7, returnPctHigh: 7 },
    inflationPct: 0,
    windfalls: [],
    majorExpenses: [],
    recurringAnnualExpenses: 40_000,
    ...overrides,
  };
}

describe('netWorthAtAge', () => {
  it('returns startingNetWorth when target age is before the horizon', () => {
    // primary born 2000; horizon starts 2030 (age 30). Ask for age 25.
    const a = baseScenario({ horizonStartYear: 2030 });
    expect(netWorthAtAge(a, 25)).toBe(a.startingNetWorth);
  });

  it('returns the row at the requested age within the horizon', () => {
    const a = baseScenario({ horizonStartYear: 2030, horizonEndYear: 2032 });
    const { rows } = simulate(a);
    // Person born 2000 → age 31 in 2031 → row index 1.
    expect(netWorthAtAge(a, 31)).toBeCloseTo(rows[1]!.netWorth, 2);
  });

  it('extends the horizon internally when target age is beyond horizonEndYear', () => {
    const short = baseScenario({ horizonStartYear: 2030, horizonEndYear: 2032 });
    // Ask for age 50 (year 2050) — the user's horizon only goes to 2032.
    const value = netWorthAtAge(short, 50);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(short.startingNetWorth);
    // Cross-check: explicitly extending the horizon gives the same number.
    const long = { ...short, horizonEndYear: 2050 };
    const { rows } = simulate(long);
    const row2050 = rows.find((r) => r.year === 2050)!;
    expect(value).toBeCloseTo(row2050.netWorth, 2);
  });

  it('returns NaN when the scenario has no people', () => {
    const a = baseScenario({ people: [] });
    expect(Number.isNaN(netWorthAtAge(a, 50))).toBe(true);
  });
});

describe('solveGoalSeek — sentinel kinds', () => {
  it('returns no-target when target is absent', () => {
    expect(solveGoalSeek(baseScenario()).kind).toBe('no-target');
  });

  it('returns no-people when target is set but there are no people', () => {
    const a = baseScenario({
      people: [],
      target: { amount: 1_000_000, age: 50 },
    });
    expect(solveGoalSeek(a).kind).toBe('no-people');
  });

  it('returns on-track with surplus when projection already meets target', () => {
    const a = baseScenario({
      target: { amount: 100, age: 50 },
    });
    const result = solveGoalSeek(a);
    if (result.kind !== 'on-track') throw new Error(`expected on-track, got ${result.kind}`);
    expect(result.surplus).toBeGreaterThan(0);
    expect(result.projected).toBeGreaterThan(result.target);
  });
});

describe('solveGoalSeek — round trip for each lever', () => {
  // Scenario tuned so every lever has room to move:
  //   - savings rate 80% → intended $60k, consumable $15k on $75k after-tax
  //   - expenses $40k → in the shortfall regime ($40k > consumable $15k)
  //     so the expense lever has somewhere to go (cutting expenses below
  //     consumable doesn't help — that's the savings-rate cap, documented
  //     in engine.ts assumption #6).
  //   - 20-yr horizon (age 30 → 50), target $2M
  //   - default 7% return projects ~$1.63M, leaving a meaningful gap for
  //     every other lever to close.
  function shortScenario(): Assumptions {
    return baseScenario({
      horizonEndYear: 2050,
      annualSavingsRatePct: 80,
      recurringAnnualExpenses: 40_000,
      target: { amount: 2_000_000, age: 50 },
    });
  }

  function assertRoundTrip(label: string, projected: number, target: number): void {
    // $5k tolerance — well above bisection's $1k stop tolerance, well
    // below any number that would change the user's interpretation.
    const drift = Math.abs(projected - target);
    if (drift > 5_000) {
      throw new Error(
        `${label}: re-simulating with the solved value gave $${projected.toLocaleString()}, ` +
          `not $${target.toLocaleString()} (drift $${drift.toLocaleString()})`,
      );
    }
  }

  it('extraMonthlyContribution: solved value → re-simulate → hits target', () => {
    const a = shortScenario();
    const r = solveGoalSeek(a);
    if (r.kind !== 'short') throw new Error('expected short');
    const lever = r.levers.extraMonthlyContribution;
    expect(lever.ok).toBe(true);
    if (!lever.ok) return;
    // Plug solved value back in and re-simulate.
    const projected = netWorthAtAge({ ...a, extraAnnualContribution: lever.value }, r.targetAge);
    assertRoundTrip('extraMonthlyContribution', projected, r.target);
  });

  it('returnPct: solved value → re-simulate → hits target', () => {
    const a = shortScenario();
    const r = solveGoalSeek(a);
    if (r.kind !== 'short') throw new Error('expected short');
    const lever = r.levers.returnPct;
    expect(lever.ok).toBe(true);
    if (!lever.ok) return;
    const projected = netWorthAtAge(
      { ...a, investment: { ...a.investment, returnPct: lever.value } },
      r.targetAge,
    );
    assertRoundTrip('returnPct', projected, r.target);
  });

  it('annualExpenses: solved value → re-simulate → hits target', () => {
    const a = shortScenario();
    const r = solveGoalSeek(a);
    if (r.kind !== 'short') throw new Error('expected short');
    const lever = r.levers.annualExpenses;
    expect(lever.ok).toBe(true);
    if (!lever.ok) return;
    const projected = netWorthAtAge({ ...a, recurringAnnualExpenses: lever.value }, r.targetAge);
    assertRoundTrip('annualExpenses', projected, r.target);
  });

  it('targetAge: solved age → re-simulate at that age → hits target', () => {
    const a = shortScenario();
    const r = solveGoalSeek(a);
    if (r.kind !== 'short') throw new Error('expected short');
    const lever = r.levers.targetAge;
    expect(lever.ok).toBe(true);
    if (!lever.ok) return;
    const projected = netWorthAtAge(a, lever.value);
    assertRoundTrip('targetAge', projected, r.target);
  });
});

describe('solveGoalSeek — unreachable cases', () => {
  it('reports "not reachable" for the expense lever when even 0 spending falls short', () => {
    // Tiny income, no starting capital, modest return, but a wildly
    // ambitious $50M target. No amount of expense-cutting can possibly
    // close the gap.
    const a = baseScenario({
      startingNetWorth: 0,
      annualSavingsRatePct: 100,
      effectiveTaxRatePct: 0,
      recurringAnnualExpenses: 5_000,
      target: { amount: 50_000_000, age: 50 },
    });
    const r = solveGoalSeek(a);
    if (r.kind !== 'short') throw new Error('expected short');
    expect(r.levers.annualExpenses.ok).toBe(false);
  });

  it('reports "not reachable" for the return lever at extreme targets', () => {
    const a = baseScenario({
      startingNetWorth: 0,
      annualSavingsRatePct: 0,
      target: { amount: 100_000_000_000, age: 50 },
    });
    const r = solveGoalSeek(a);
    if (r.kind !== 'short') throw new Error('expected short');
    expect(r.levers.returnPct.ok).toBe(false);
  });
});

describe('solveGoalSeek — deltas reflect distance from current setting', () => {
  // Reuse the round-trip-tuned scenario where the expense lever has
  // headroom (savings rate 80%, so cutting expenses meaningfully changes
  // saved$ until the consumable threshold is reached).
  function shortScenarioForDeltas(): Assumptions {
    return baseScenario({
      annualSavingsRatePct: 80,
      recurringAnnualExpenses: 40_000,
      target: { amount: 2_000_000, age: 50 },
    });
  }

  it('reports a negative delta for an expense lever that requires cutting (current → lower)', () => {
    // Spending lever: solved value < current → delta < 0.
    const a = shortScenarioForDeltas();
    const r = solveGoalSeek(a);
    if (r.kind !== 'short') throw new Error('expected short');
    const lever = r.levers.annualExpenses;
    if (!lever.ok) return; // tolerated if scenario happens to be unreachable
    expect(lever.delta).toBeLessThan(0);
    expect(lever.value).toBeLessThan(a.recurringAnnualExpenses);
  });

  it('reports a positive delta for the return lever (current → higher)', () => {
    const a = shortScenarioForDeltas();
    const r = solveGoalSeek(a);
    if (r.kind !== 'short') throw new Error('expected short');
    const lever = r.levers.returnPct;
    if (!lever.ok) return;
    expect(lever.delta).toBeGreaterThan(0);
    expect(lever.value).toBeGreaterThan(a.investment.returnPct);
  });
});
