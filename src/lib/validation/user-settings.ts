import { z } from 'zod';

/**
 * User settings — one row per user, keyed by user_id. The row is
 * auto-created on first GET if it doesn't exist (typical "settings"
 * pattern, avoids special-casing the missing-row case in the UI).
 *
 * Field coverage:
 *   - default_currency: 3-letter ISO code (e.g. USD, EUR).
 *   - inflation_assumption: % used as the default simulator inflation
 *     when no override is set on a scenario. 0–50.
 *   - effective_lt_tax_rate_pct / effective_st_tax_rate_pct: % used by
 *     the per-lot hypothetical-sale tax estimate. Both default to 0,
 *     which the UI interprets as "not set" and hides tax estimates.
 *     Range 0–80 matches the DB CHECK (covers any realistic combined
 *     federal+state+NIIT bracket).
 */

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .length(3)
  .regex(/^[A-Z]{3}$/);

const pct = (max: number) =>
  z
    .number()
    .min(0)
    .max(max)
    .refine((n) => Number.isFinite(n), 'must be finite')
    .refine(
      (n) => Math.round(n * 100) === n * 100,
      'at most 2 decimal places',
    );

export const updateUserSettingsSchema = z
  .object({
    default_currency: currency.optional(),
    inflation_assumption: pct(50).optional(),
    effective_lt_tax_rate_pct: pct(80).optional(),
    effective_st_tax_rate_pct: pct(80).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'no fields to update',
  });
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;

export type UserSettings = {
  user_id: string;
  default_currency: string;
  inflation_assumption: number;
  effective_lt_tax_rate_pct: number;
  effective_st_tax_rate_pct: number;
  created_at: string;
  updated_at: string;
};
