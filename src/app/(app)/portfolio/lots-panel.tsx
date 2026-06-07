'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/components/ui/toast';
import {
  classifyLot,
  estimateSale,
  type LotClassification,
} from '@/lib/derived/lots';
import { formatCurrency, formatQty } from '@/lib/format/money';

type LotRow = {
  id: string;
  holding_id: string;
  quantity: number;
  cost_basis: number;
  acquired_on: string;
  acquired_on_estimated: boolean;
};

/**
 * Per-holding tax-lot panel. Loaded lazily when the user expands the
 * holding row in PortfolioClient.
 *
 * Honors the migration-0003 contract: lots with
 * `acquired_on_estimated = true` render as "needs review" with a CTA to
 * set a real date. Their tax estimate is NOT computed even if the user
 * has set effective rates.
 *
 * The full "estimate only, not tax advice" disclaimer lives on the
 * settings page (next to the rate inputs); a compact reminder is shown
 * inline here when any tax-estimate column is rendered.
 */
export default function LotsPanel({
  holdingId,
  currentPrice,
  ltTaxRatePct,
  stTaxRatePct,
  currency,
  onTotalsChanged,
}: {
  holdingId: string;
  currentPrice: number | null;
  ltTaxRatePct: number;
  stTaxRatePct: number;
  currency: string;
  /** Called after a lot mutation lands so the parent can refresh totals. */
  onTotalsChanged: () => void;
}) {
  const toast = useToast();
  const [lots, setLots] = useState<LotRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingDateLotId, setEditingDateLotId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/holdings/${holdingId}/lots`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { lots: LotRow[] }) => {
        if (cancelled) return;
        setLots(j.lots);
      })
      .catch(() => setError('Could not load lots.'));
    return () => {
      cancelled = true;
    };
  }, [holdingId]);

  async function setAcquisitionDate(lotId: string, dateIso: string) {
    setError(null);
    const res = await fetch(`/api/holdings/${holdingId}/lots/${lotId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acquired_on: dateIso }),
    });
    if (!res.ok) {
      setError('Could not update.');
      return;
    }
    const j = (await res.json()) as { lot: LotRow };
    setLots((arr) => (arr ?? []).map((l) => (l.id === lotId ? j.lot : l)));
    setEditingDateLotId(null);
    toast.success('Acquisition date set — lot classified.');
  }

  async function addLot(input: { quantity: number; cost_basis: number; acquired_on: string }) {
    setError(null);
    const res = await fetch(`/api/holdings/${holdingId}/lots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      setError('Could not add lot.');
      return;
    }
    const j = (await res.json()) as { lot: LotRow };
    setLots((arr) => [...(arr ?? []), j.lot]);
    setShowAdd(false);
    toast.success('Lot added.');
    onTotalsChanged();
  }

  async function removeLot(lotId: string) {
    if (!confirm('Remove this lot? The holding total will be recomputed.')) return;
    setError(null);
    const res = await fetch(`/api/holdings/${holdingId}/lots/${lotId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body?.error === 'last_lot_cannot_be_removed') {
        setError(
          'A holding must have at least one lot. Delete the holding from the portfolio list instead.',
        );
      } else {
        setError('Could not remove lot.');
      }
      return;
    }
    setLots((arr) => (arr ?? []).filter((l) => l.id !== lotId));
    toast.success('Lot removed.');
    onTotalsChanged();
  }

  if (lots === null && !error) {
    return <p className="text-muted px-3 py-2 text-[11px]">Loading lots…</p>;
  }
  if (error && lots === null) {
    return <p className="text-negative px-3 py-2 text-[11px]">{error}</p>;
  }

  const ratesPresent = ltTaxRatePct > 0 && stTaxRatePct > 0;

  return (
    <div className="border-border bg-foreground/[0.02] rounded border p-3">
      <ul className="flex flex-col gap-2">
        {(lots ?? []).map((lot) => {
          const cls = classifyLot(lot);
          const est =
            currentPrice !== null
              ? estimateSale(
                  {
                    ...lot,
                    current_price: currentPrice,
                    ltTaxRatePct,
                    stTaxRatePct,
                  },
                )
              : null;
          return (
            <li key={lot.id} className="border-border rounded border p-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <ClassificationBadge cls={cls} />
                    <span className="text-muted nums text-[11px]">
                      {formatQty(lot.quantity)} · cost{' '}
                      {formatCurrency(lot.cost_basis, { currency })}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span
                      className={`nums text-[11px] ${
                        lot.acquired_on_estimated ? 'text-muted italic' : 'text-foreground'
                      }`}
                    >
                      Acquired {lot.acquired_on}
                      {lot.acquired_on_estimated ? ' (estimated)' : ''}
                    </span>
                    {lot.acquired_on_estimated &&
                      editingDateLotId !== lot.id ? (
                        <button
                          type="button"
                          onClick={() => setEditingDateLotId(lot.id)}
                          className="text-accent hover:text-foreground text-[11px] underline"
                        >
                          Set real date
                        </button>
                      ) : null}
                  </div>
                  {editingDateLotId === lot.id ? (
                    <SetDateInline
                      defaultValue={lot.acquired_on}
                      onCancel={() => setEditingDateLotId(null)}
                      onSubmit={(d) => setAcquisitionDate(lot.id, d)}
                    />
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {est !== null ? (
                    <>
                      <span className="nums text-sm">
                        {formatCurrency(est.marketValue, { currency })}
                      </span>
                      <span
                        className={`nums text-[11px] ${
                          est.unrealizedGain > 0
                            ? 'text-positive'
                            : est.unrealizedGain < 0
                              ? 'text-negative'
                              : 'text-muted'
                        }`}
                      >
                        {est.unrealizedGain > 0 ? '+' : est.unrealizedGain < 0 ? '−' : ''}
                        {formatCurrency(Math.abs(est.unrealizedGain), { currency })}
                      </span>
                      {est.taxEstimate !== null && ratesPresent ? (
                        <span className="text-muted nums text-[10px]">
                          est. tax {formatCurrency(est.taxEstimate, { currency })}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted text-[11px]">no quote</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeLot(lot.id)}
                    className="text-muted hover:text-negative text-[10px]"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="border-border hover:bg-foreground/5 rounded border px-2 py-1 text-[11px]"
        >
          {showAdd ? 'Cancel' : '+ Add lot'}
        </button>
        {ratesPresent ? (
          <p className="text-muted text-[10px] italic">
            Estimate only, not tax advice. See settings for caveats.
          </p>
        ) : (
          <p className="text-muted text-[10px] italic">
            Set effective LT/ST rates in Settings → Tax-estimate rates to see
            tax estimates here.
          </p>
        )}
      </div>

      {showAdd ? <AddLotForm onCancel={() => setShowAdd(false)} onSubmit={addLot} /> : null}

      {error ? <p className="text-negative mt-2 text-[11px]">{error}</p> : null}
    </div>
  );
}

function ClassificationBadge({ cls }: { cls: LotClassification }) {
  const styles: Record<LotClassification, string> = {
    long_term: 'bg-positive/15 text-positive',
    short_term: 'bg-accent/15 text-accent',
    needs_review: 'bg-foreground/10 text-muted',
  };
  const labels: Record<LotClassification, string> = {
    long_term: 'Long-term',
    short_term: 'Short-term',
    needs_review: 'Needs review',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${styles[cls]}`}>
      {labels[cls]}
    </span>
  );
}

function SetDateInline({
  defaultValue,
  onCancel,
  onSubmit,
}: {
  defaultValue: string;
  onCancel: () => void;
  onSubmit: (dateIso: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={value}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => setValue(e.target.value)}
        className="border-border bg-background rounded border px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={() => onSubmit(value)}
        className="bg-foreground text-background rounded px-2 py-1 text-xs"
      >
        Save
      </button>
      <button type="button" onClick={onCancel} className="text-muted text-xs">
        Cancel
      </button>
    </div>
  );
}

function AddLotForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: { quantity: number; cost_basis: number; acquired_on: string }) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [qty, setQty] = useState('');
  const [cb, setCb] = useState('');
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const qtyNum = Number(qty);
    const cbNum = Number(cb);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('Quantity must be > 0.');
      return;
    }
    if (!Number.isFinite(cbNum) || cbNum < 0) {
      setError('Cost basis must be ≥ 0.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Pick a date.');
      return;
    }
    onSubmit({ quantity: qtyNum, cost_basis: cbNum, acquired_on: date });
  }

  return (
    <div className="border-border mt-3 flex flex-col gap-2 rounded border p-2.5">
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-muted text-[10px]">Quantity</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={qty}
            placeholder="0"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setQty(e.target.value)}
            className="border-border bg-background rounded border px-2 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-muted text-[10px]">Cost basis</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={cb}
            placeholder="0"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setCb(e.target.value)}
            className="border-border bg-background rounded border px-2 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-muted text-[10px]">Acquired</span>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            className="border-border bg-background rounded border px-2 py-1 text-xs"
          />
        </label>
      </div>
      {error ? <p className="text-negative text-[11px]">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          className="bg-foreground text-background rounded px-2 py-1 text-xs"
        >
          Add lot
        </button>
        <button type="button" onClick={onCancel} className="text-muted text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}
