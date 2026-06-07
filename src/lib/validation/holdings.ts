import { z } from 'zod';

export const ASSET_TYPES = ['stock', 'etf', 'crypto'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

// Symbols are uppercase letters/digits/dash/dot, 1-20 chars. Examples:
// AAPL, VOO, BRK.B, BTC-USD.
const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(20)
  .regex(/^[A-Z0-9.\-]+$/, 'invalid symbol');

// Plain numbers (no coercion) so input/output types align with useForm.
const quantity = z
  .number()
  .min(0)
  .max(1e15)
  .refine((n) => Number.isFinite(n), 'must be finite');

const costBasis = z
  .number()
  .min(0)
  .max(999_999_999_999.99)
  .refine((n) => Math.round(n * 100) === n * 100, 'at most 2 decimal places');

export const createHoldingSchema = z.object({
  account_id: z.string().uuid(),
  symbol,
  asset_type: z.enum(ASSET_TYPES),
  quantity,
  cost_basis: costBasis,
  // Optional. When omitted, the server defaults to today's date and
  // sets `acquired_on_estimated = true` so the UI prompts the user to
  // confirm. See migration 0003 header for the classification contract.
  acquired_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'acquired_on must be YYYY-MM-DD')
    .optional(),
  acquired_on_estimated: z.boolean().optional(),
});
export type CreateHoldingInput = z.infer<typeof createHoldingSchema>;

export const updateHoldingSchema = z
  .object({
    account_id: z.string().uuid().optional(),
    symbol: symbol.optional(),
    asset_type: z.enum(ASSET_TYPES).optional(),
    quantity: quantity.optional(),
    cost_basis: costBasis.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'no fields to update',
  });
export type UpdateHoldingInput = z.infer<typeof updateHoldingSchema>;

/** Query schema for GET /api/quotes?symbols=AAPL,VOO. */
export const quotesQuerySchema = z.object({
  symbols: z
    .string()
    .min(1)
    .max(200)
    .transform((s) =>
      Array.from(
        new Set(
          s
            .split(',')
            .map((x) => x.trim().toUpperCase())
            .filter((x) => x.length > 0 && x.length <= 20),
        ),
      ),
    )
    .refine((arr) => arr.length > 0 && arr.length <= 25, 'between 1 and 25 symbols'),
});
