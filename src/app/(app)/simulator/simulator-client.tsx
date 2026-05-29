'use client';

import { useMemo, useState } from 'react';

import SimulatorChart, { type Marker } from '@/components/charts/simulator-chart';
import { simulate } from '@/lib/simulator/engine';
import type { Scenario } from '@/lib/types/scenario';
import type { Assumptions } from '@/lib/validation/scenarios';

import AssumptionsForm from './assumptions-form';
import { defaultAssumptions } from './default-assumptions';
import YearTable from './year-table';

function fmtCurrency0(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
}

export default function SimulatorClient({
  initialScenarios,
}: {
  initialScenarios: Scenario[];
}) {
  // Scenario state: which one we're editing (or undefined = New Scenario).
  const [selectedId, setSelectedId] = useState<string | 'new'>(
    initialScenarios[0]?.id ?? 'new',
  );
  const [assumptions, setAssumptions] = useState<Assumptions>(
    initialScenarios[0]?.assumptions ?? defaultAssumptions(),
  );
  const [displayMode, setDisplayMode] = useState<'nominal' | 'real'>('nominal');
  const [showTable, setShowTable] = useState(false);

  // Result recomputes whenever assumptions change. Pure math, fine on
  // every render — no debounce needed for typical horizon sizes.
  const result = useMemo(() => {
    try {
      return simulate(assumptions);
    } catch (err) {
      console.warn('[simulator] simulate failed', err);
      return null;
    }
  }, [assumptions]);

  function onScenarioChange(id: string) {
    setSelectedId(id);
    if (id === 'new') {
      setAssumptions(defaultAssumptions());
      return;
    }
    const found = initialScenarios.find((s) => s.id === id);
    if (found) setAssumptions(found.assumptions);
  }

  const lastNominal = result?.rows[result.rows.length - 1]?.netWorth ?? 0;
  const lastReal = result?.rows[result.rows.length - 1]?.netWorthRealTodayDollars ?? 0;
  const firstNominal = result?.rows[0]?.netWorth ?? 0;
  const totalGrowth = firstNominal > 0 ? (lastNominal / firstNominal - 1) * 100 : 0;

  // Markers: one dot per windfall and per active major-expense year, placed
  // on the BASE line at that year's value.
  const markers = useMemo<Marker[]>(() => {
    if (!result) return [];
    const byYear = new Map(result.rows.map((r) => [r.year, r]));
    const out: Marker[] = [];
    for (const w of assumptions.windfalls) {
      const row = byYear.get(w.year);
      if (!row) continue;
      out.push({
        year: w.year,
        value: displayMode === 'real' ? row.netWorthRealTodayDollars : row.netWorth,
        label: w.label,
        tone: 'windfall',
      });
    }
    for (const e of assumptions.majorExpenses) {
      const yrs =
        'year' in e
          ? [e.year]
          : Array.from({ length: e.years }, (_, i) => e.startYear + i);
      for (const y of yrs) {
        const row = byYear.get(y);
        if (!row) continue;
        out.push({
          year: y,
          value: displayMode === 'real' ? row.netWorthRealTodayDollars : row.netWorth,
          label: e.label,
          tone: 'expense',
        });
      }
    }
    return out;
  }, [result, assumptions.windfalls, assumptions.majorExpenses, displayMode]);

  // Years to highlight in the table — career-stage starts, windfalls,
  // and active major-expense years.
  const highlightYears = useMemo(() => {
    const set = new Set<number>();
    for (const p of assumptions.people) {
      for (const s of p.careerStages) {
        set.add(p.birthYear + s.startAge);
      }
    }
    for (const w of assumptions.windfalls) set.add(w.year);
    for (const e of assumptions.majorExpenses) {
      if ('year' in e) set.add(e.year);
      else for (let i = 0; i < e.years; i += 1) set.add(e.startYear + i);
    }
    return set;
  }, [assumptions.people, assumptions.windfalls, assumptions.majorExpenses]);

  return (
    <div className="flex flex-col gap-6">
      {/* Scenario selector */}
      <div className="flex flex-col gap-2">
        <label className="text-muted text-[10px] tracking-[0.18em] uppercase">Scenario</label>
        <select
          className="border-border bg-background rounded border px-3 py-2 text-sm"
          value={selectedId}
          onChange={(e) => onScenarioChange(e.target.value)}
        >
          <option value="new">New scenario</option>
          {initialScenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="text-muted text-[10px]">
          Save / duplicate / compare arrive in the next sub-steps.
        </p>
      </div>

      {/* Live summary at the top so the form edits feel responsive. */}
      <section className="border-border rounded border p-4">
        <p className="text-muted text-[10px] tracking-[0.18em] uppercase">
          Final balance · {assumptions.horizonEndYear}
        </p>
        <p className="serif-display nums mt-1 text-3xl">{fmtCurrency0(lastNominal)}</p>
        <p className="text-muted nums mt-1 text-xs">
          {fmtCurrency0(lastReal)} in today&apos;s dollars · {fmtPct(totalGrowth)} over horizon
        </p>
      </section>

      {/* Chart + nominal/real toggle. */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-muted text-[10px] tracking-[0.18em] uppercase">
            Projection · low–high band
          </p>
          <div className="border-border flex rounded border text-[11px]">
            <button
              type="button"
              onClick={() => setDisplayMode('nominal')}
              className={`px-2.5 py-1 ${displayMode === 'nominal' ? 'bg-foreground/10 text-foreground' : 'text-muted'}`}
            >
              Nominal
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('real')}
              className={`px-2.5 py-1 ${displayMode === 'real' ? 'bg-foreground/10 text-foreground' : 'text-muted'}`}
            >
              Real
            </button>
          </div>
        </div>
        {result ? (
          <SimulatorChart result={result} mode={displayMode} markers={markers} />
        ) : (
          <p className="text-negative text-xs">Could not compute projection — check inputs.</p>
        )}
        <p className="text-muted text-[10px]">
          Band = pessimistic to optimistic return. Green dots are windfall
          years; red dots are major-expense years.
        </p>
      </section>

      {/* Year-by-year table. */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-muted text-[10px] tracking-[0.18em] uppercase">
            Year by year
          </p>
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="text-muted hover:text-foreground text-xs"
          >
            {showTable ? 'Hide table' : 'Show table'}
          </button>
        </div>
        {showTable && result ? (
          <YearTable
            rows={result.rows}
            people={assumptions.people}
            highlightYears={highlightYears}
          />
        ) : null}
      </section>

      {/* The big assumptions form. */}
      <AssumptionsForm value={assumptions} onChange={setAssumptions} />

      <p className="text-muted text-[10px] italic">
        Estimates based on your assumptions. Not a prediction or financial
        advice. Career preset salaries are illustrative defaults, not market
        data — replace with your own figures.
      </p>
    </div>
  );
}
