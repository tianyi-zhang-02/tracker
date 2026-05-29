/**
 * Database row shape for `public.account_snapshots`.
 */
export type Snapshot = {
  id: string;
  user_id: string;
  account_id: string;
  /** numeric(14,2) — Supabase serializes to a string. */
  balance: string;
  snapshot_date: string;
  created_at: string;
};

export type SnapshotWithAccount = Snapshot & {
  account: { id: string; name: string; type: string; currency: string } | null;
};
