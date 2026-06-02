import type { Assumptions } from '@/lib/validation/scenarios';

/**
 * A reasonable starting point for a new scenario. Editorially neutral —
 * the user should override everything before relying on the projection.
 */
export function defaultAssumptions(): Assumptions {
  const thisYear = new Date().getFullYear();
  return {
    horizonStartYear: thisYear,
    horizonEndYear: thisYear + 30,
    people: [],
    startingNetWorth: 0,
    startingInvested: 0,
    annualSavingsRatePct: 20,
    effectiveTaxRatePct: 30,
    investment: { returnPct: 7, returnPctLow: 4, returnPctHigh: 10 },
    inflationPct: 3,
    windfalls: [],
    majorExpenses: [],
    recurringAnnualExpenses: 60_000,
  };
}

export function newId(): string {
  // crypto.randomUUID is supported in modern browsers + Node 19+.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
