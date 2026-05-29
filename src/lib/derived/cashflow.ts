import type { TransactionKind } from '@/lib/validation/transactions';

/**
 * Pure derivation: given a window of transactions, compute the annualized
 * cash-flow aggregates the simulator's prefill (and the polish pass's
 * dashboard cards) consume. No DB, no network.
 *
 * Transactions are summed within the supplied window and scaled to a full
 * year by `12 / monthsObserved` — this lets a partial window (say 6 months
 * because the user is new) still produce a sensible annualized figure.
 *
 * `annualSavingsRatePct` is an estimate of (net inflow into savings or
 * invested) / (gross income), clamped to [0, 100]. If gross income is zero,
 * returns 0 rather than dividing by zero.
 */

export type CashflowInput = Array<{
  kind: TransactionKind;
  /** Always positive; the kind controls the sign. */
  amount: number;
}>;

export type CashflowSummary = {
  /** How many calendar months the input covers (≥ 1). */
  monthsObserved: number;
  annualGrossIncome: number;
  /** Sum of all `expense` kinds, annualized. */
  annualBaselineExpenses: number;
  /** savings_deposit − savings_withdrawal, annualized. */
  annualNetSavings: number;
  /** annualNetSavings / annualGrossIncome, clamped 0–100. 0 if no income. */
  annualSavingsRatePct: number;
};

export function deriveCashflow(
  txs: CashflowInput,
  monthsObserved: number,
): CashflowSummary {
  const months = Math.max(1, monthsObserved);
  let income = 0;
  let expense = 0;
  let saved = 0;
  let withdrawn = 0;
  for (const t of txs) {
    if (!Number.isFinite(t.amount) || t.amount < 0) continue;
    switch (t.kind) {
      case 'income':
        income += t.amount;
        break;
      case 'expense':
        expense += t.amount;
        break;
      case 'savings_deposit':
        saved += t.amount;
        break;
      case 'savings_withdrawal':
        withdrawn += t.amount;
        break;
    }
  }
  const scale = 12 / months;
  const annualGrossIncome = income * scale;
  const annualBaselineExpenses = expense * scale;
  const annualNetSavings = (saved - withdrawn) * scale;
  const rawRate =
    annualGrossIncome > 0 ? (annualNetSavings / annualGrossIncome) * 100 : 0;
  const annualSavingsRatePct = Math.max(0, Math.min(100, rawRate));
  return {
    monthsObserved: months,
    annualGrossIncome,
    annualBaselineExpenses,
    annualNetSavings,
    annualSavingsRatePct,
  };
}
