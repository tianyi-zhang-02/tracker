import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Recompute sum(lots.quantity) and sum(lots.cost_basis) for one holding
 * and write them back to `holdings.quantity` / `holdings.cost_basis`.
 *
 * This is the function every code path that mutates `holding_lots` MUST
 * call to preserve the holdings ↔ holding_lots invariant:
 *
 *     sum(lot.quantity)   = holdings.quantity
 *     sum(lot.cost_basis) = holdings.cost_basis
 *     to the cent.
 *
 * Caller owns auth + ownership; this helper just does the math.
 *
 * Uses scaled-integer arithmetic so that 0.1+0.2 floating-point quirks
 * don't shift a column by a hundredth of a cent. The DB CHECK would
 * still accept micro-drift, but over many edits the invariant would
 * slowly drift away from sum(lots) and the dashboard total would
 * disagree with the lots view.
 *
 * Returns `{ ok: true }` on success or `{ ok: false, code }` on the
 * first DB error.
 *
 * Failure mode note: this helper does two writes (one SELECT, one
 * UPDATE) so a failure between them leaves lots present but holdings
 * stale. Inverse of the usual concern (holding totals would be too
 * LOW, not lots over-counted) and recoverable by re-running this
 * helper. A future PR can add a periodic reconciliation cron.
 */
export async function syncHoldingTotals(
  supabase: SupabaseClient,
  userId: string,
  holdingId: string,
): Promise<{ ok: true } | { ok: false; code: string | undefined }> {
  const { data: lots, error: selErr } = await supabase
    .from('holding_lots')
    .select('quantity, cost_basis')
    .eq('holding_id', holdingId)
    .eq('user_id', userId);
  if (selErr) return { ok: false, code: selErr.code };

  let qtyScaled = 0;
  let cbCents = 0;
  for (const l of lots ?? []) {
    qtyScaled += Math.round(Number(l.quantity) * 1e8);
    cbCents += Math.round(Number(l.cost_basis) * 100);
  }
  const quantity = qtyScaled / 1e8;
  const cost_basis = cbCents / 100;

  const { error: updErr } = await supabase
    .from('holdings')
    .update({ quantity, cost_basis })
    .eq('id', holdingId)
    .eq('user_id', userId);
  if (updErr) return { ok: false, code: updErr.code };

  return { ok: true };
}
