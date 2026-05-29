import type { Assumptions } from '@/lib/validation/scenarios';

/**
 * Database row shape for `public.scenarios`. The jsonb `assumptions` column
 * is validated with zod on every write; clients can trust the runtime shape.
 */
export type Scenario = {
  id: string;
  user_id: string;
  name: string;
  assumptions: Assumptions;
  created_at: string;
  updated_at: string;
};
