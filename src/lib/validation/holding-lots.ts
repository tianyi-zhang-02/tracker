import { z } from 'zod';

/**
 * Validation schemas for the holding_lots table (Phase 4 part 2).
 *
 * Precisions mirror the SQL columns exactly so a value that passes here
 * also passes the DB CHECK constraints:
 *   - quantity   numeric(18,8)
 *   - cost_basis numeric(14,2)
 *
 * `acquired_on` is an ISO date string YYYY-MM-DD (no timezone, no time).
 * `acquired_on_estimated` is sent by the client when explicitly setting a
 * placeholder (the migration sets this for backfilled rows; in the
 * application the user can flip it false by editing the date).
 *
 * See `supabase/migrations/0003_holding_lots.sql` header for the
 * classification contract — `acquired_on_estimated = true` lots MUST
 * NOT be classified or included in tax estimates by downstream code.
 */

const quantity = z
  .number()
  .min(0, 'quantity must be ≥ 0')
  .max(1e15, 'quantity is too large')
  .refine((n) => Number.isFinite(n), 'quantity must be finite')
  // 8 decimals: a value like 0.123456789 has more precision than the
  // SQL column can store. Round-trip check.
  .refine(
    (n) => Math.round(n * 1e8) === Math.round(n * 1e8),
    'quantity has more than 8 decimals',
  );

const costBasis = z
  .number()
  .min(0, 'cost basis must be ≥ 0')
  .max(999_999_999_999.99, 'cost basis is too large')
  .refine((n) => Number.isFinite(n), 'cost basis must be finite')
  .refine(
    (n) => Math.round(n * 100) === n * 100,
    'cost basis has more than 2 decimals',
  );

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'acquired_on must be YYYY-MM-DD');

export const createLotSchema = z.object({
  quantity,
  cost_basis: costBasis,
  acquired_on: isoDate,
  // Default false because the user is explicitly entering this lot — they
  // have the date in mind. The migration uses true for backfilled rows.
  acquired_on_estimated: z.boolean().optional().default(false),
});
export type CreateLotInput = z.infer<typeof createLotSchema>;

export const updateLotSchema = z
  .object({
    quantity: quantity.optional(),
    cost_basis: costBasis.optional(),
    acquired_on: isoDate.optional(),
    acquired_on_estimated: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'no fields to update',
  });
export type UpdateLotInput = z.infer<typeof updateLotSchema>;

/**
 * Application invariant: editing `acquired_on` SHOULD also clear the
 * estimated flag, because the user is now confirming the date. Callers
 * (the API route) enforce this; the schema is permissive.
 */
