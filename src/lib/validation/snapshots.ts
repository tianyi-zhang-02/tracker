import { z } from 'zod';

const balance = z
  .number()
  // Snapshots can be negative (overdrawn cash) or zero, so no .positive().
  .min(-999_999_999_999.99, 'balance too small')
  .max(999_999_999_999.99, 'balance too large')
  .refine((n) => Math.round(n * 100) === n * 100, 'at most 2 decimal places');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const createSnapshotSchema = z.object({
  account_id: z.string().uuid(),
  balance,
  snapshot_date: isoDate,
});
export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;

/**
 * Bulk month-end flow. The client submits one balance per account for a
 * single snapshot_date; the server upserts on (account_id, snapshot_date)
 * so re-submission overwrites prior entries for the same day.
 */
export const bulkSnapshotSchema = z.object({
  snapshot_date: isoDate,
  entries: z
    .array(z.object({ account_id: z.string().uuid(), balance }))
    .min(1, 'no entries')
    .max(50, 'too many entries'),
});
export type BulkSnapshotInput = z.infer<typeof bulkSnapshotSchema>;

export const snapshotFiltersSchema = z.object({
  account: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().positive().max(2000).default(500),
});
export type SnapshotFilters = z.infer<typeof snapshotFiltersSchema>;
