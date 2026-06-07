'use client';

import { useEffect, useState } from 'react';

import type { UserSettings } from '@/lib/validation/user-settings';

/**
 * Effective LT / ST capital-gains tax rates used by the per-lot
 * hypothetical-sale estimate on /portfolio. Both default to 0 in
 * the DB; the portfolio UI hides the tax-estimate column entirely
 * until both rates are positive.
 *
 * Surface copy is deliberately conservative:
 *   - "Effective" rates, not "marginal," because users are estimating
 *     blended impact, not a single bracket.
 *   - "Used only for the hypothetical-sale estimate" — make clear what
 *     these affect, so no one thinks they're filing-related.
 *   - The "estimate only, not tax advice" disclaimer.
 */
export default function TaxRatesForm() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [lt, setLt] = useState<string>('');
  const [st, setSt] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/user-settings')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { settings: UserSettings }) => {
        if (cancelled) return;
        setSettings(j.settings);
        // Render 0 as empty string so the field shows the placeholder
        // "0" hint, consistent with the simulator's input UX.
        setLt(j.settings.effective_lt_tax_rate_pct === 0 ? '' : String(j.settings.effective_lt_tax_rate_pct));
        setSt(j.settings.effective_st_tax_rate_pct === 0 ? '' : String(j.settings.effective_st_tax_rate_pct));
      })
      .catch(() => setError('Could not load settings.'));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setError(null);
    setSavedAt(null);
    const ltNum = lt.trim() === '' ? 0 : Number(lt);
    const stNum = st.trim() === '' ? 0 : Number(st);
    if (!Number.isFinite(ltNum) || !Number.isFinite(stNum) || ltNum < 0 || stNum < 0 || ltNum > 80 || stNum > 80) {
      setError('Both rates must be numbers between 0 and 80.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/user-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          effective_lt_tax_rate_pct: ltNum,
          effective_st_tax_rate_pct: stNum,
        }),
      });
      if (!res.ok) {
        setError('Could not save.');
        return;
      }
      const j = (await res.json()) as { settings: UserSettings };
      setSettings(j.settings);
      setSavedAt(Date.now());
    } catch {
      setError('Network error.');
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    settings !== null &&
    ((lt.trim() === '' ? 0 : Number(lt)) !== settings.effective_lt_tax_rate_pct ||
      (st.trim() === '' ? 0 : Number(st)) !== settings.effective_st_tax_rate_pct);

  return (
    <div className="border-border flex flex-col gap-3 rounded border p-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">Long-term rate</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              step={0.5}
              min={0}
              max={80}
              value={lt}
              placeholder="0"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setLt(e.target.value)}
              className="border-border focus:border-foreground nums w-full rounded border bg-transparent px-3 py-2 text-base outline-none"
            />
            <span className="text-muted text-xs">%</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">Short-term rate</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              step={0.5}
              min={0}
              max={80}
              value={st}
              placeholder="0"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setSt(e.target.value)}
              className="border-border focus:border-foreground nums w-full rounded border bg-transparent px-3 py-2 text-base outline-none"
            />
            <span className="text-muted text-xs">%</span>
          </div>
        </label>
      </div>
      <p className="text-muted text-[11px]">
        Used only for the hypothetical-sale estimate shown on the portfolio
        page. Enter your effective blended rate (federal + state + NIIT if
        relevant). 0 = leave the estimate hidden.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="bg-foreground text-background rounded px-3 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save rates'}
        </button>
        {error ? <span className="text-negative text-[11px]">{error}</span> : null}
        {savedAt && !dirty ? (
          <span className="text-positive text-[11px]">Saved.</span>
        ) : null}
      </div>
      <p className="text-muted text-[10px] italic">
        Estimate only, not tax advice. Wash sales, lot-selection methods,
        state-specific surtaxes beyond this blended rate, and NIIT
        thresholds are not modeled. Consult a tax professional before
        relying on these numbers for a real transaction.
      </p>
    </div>
  );
}
