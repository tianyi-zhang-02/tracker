import { z } from 'zod';

// ---------- Building blocks ----------

const label = z.string().trim().min(1).max(80);
const year = z.number().int().min(1900).max(2200);
const age = z.number().min(0).max(120);
const money = z
  .number()
  .min(-1e12)
  .max(1e12)
  .refine((n) => Number.isFinite(n), 'must be finite');
const positiveMoney = z.number().min(0).max(1e12).refine((n) => Number.isFinite(n), 'must be finite');
const pct = z.number().min(-100).max(500);

const careerStageSchema = z.object({
  label,
  startAge: age,
  baseSalary: positiveMoney,
  annualRaisePct: z.number().min(-50).max(100),
  bonusPct: z.number().min(0).max(500).optional(),
});
export type CareerStage = z.infer<typeof careerStageSchema>;

const personSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  birthYear: year,
  careerStages: z.array(careerStageSchema).max(20),
});
export type Person = z.infer<typeof personSchema>;

// majorExpenses can be a one-time event or a recurring stream.
const oneTimeMajorSchema = z.object({
  label,
  year,
  amount: money,
});
const recurringMajorSchema = z.object({
  label,
  startYear: year,
  annualAmount: money,
  years: z.number().int().min(1).max(200),
});
export const majorExpenseSchema = z.union([oneTimeMajorSchema, recurringMajorSchema]);
export type MajorExpense = z.infer<typeof majorExpenseSchema>;

const windfallSchema = z.object({
  label,
  year,
  amount: money,
});
export type Windfall = z.infer<typeof windfallSchema>;

const investmentSchema = z
  .object({
    returnPct: z.number().min(-50).max(100),
    returnPctLow: z.number().min(-50).max(100),
    returnPctHigh: z.number().min(-50).max(100),
  })
  .refine((v) => v.returnPctLow <= v.returnPct && v.returnPct <= v.returnPctHigh, {
    message: 'returnPctLow ≤ returnPct ≤ returnPctHigh',
  });
export type Investment = z.infer<typeof investmentSchema>;

// ---------- Top-level assumptions ----------

export const assumptionsSchema = z
  .object({
    horizonStartYear: year,
    horizonEndYear: year,
    people: z.array(personSchema).max(10),
    startingNetWorth: money,
    startingInvested: positiveMoney,
    annualSavingsRatePct: z.number().min(0).max(100),
    effectiveTaxRatePct: z.number().min(0).max(80),
    investment: investmentSchema,
    inflationPct: z.number().min(-20).max(50),
    windfalls: z.array(windfallSchema).max(100),
    majorExpenses: z.array(majorExpenseSchema).max(100),
    recurringAnnualExpenses: positiveMoney,
  })
  .refine((v) => v.horizonEndYear >= v.horizonStartYear, {
    message: 'horizonEndYear must be ≥ horizonStartYear',
  })
  .refine((v) => v.startingInvested <= Math.max(0, v.startingNetWorth), {
    message: 'startingInvested cannot exceed startingNetWorth',
  });

export type Assumptions = z.infer<typeof assumptionsSchema>;

// ---------- Scenario row schemas ----------

export const createScenarioSchema = z.object({
  name: z.string().trim().min(1).max(80),
  assumptions: assumptionsSchema,
});
export type CreateScenarioInput = z.infer<typeof createScenarioSchema>;

export const updateScenarioSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    assumptions: assumptionsSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.assumptions !== undefined, {
    message: 'no fields to update',
  });
export type UpdateScenarioInput = z.infer<typeof updateScenarioSchema>;

// Silence "unused" on shared `pct` symbol — kept for downstream forms.
export { pct };
