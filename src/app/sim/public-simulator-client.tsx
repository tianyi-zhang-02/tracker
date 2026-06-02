'use client';

import { useMemo, useState } from 'react';

import SimulatorChart, { type Marker } from '@/components/charts/simulator-chart';
import AssumptionsForm from '@/components/simulator/assumptions-form';
import CompareView, { type ComparableScenario } from '@/components/simulator/compare-view';
import { defaultAssumptions, newId } from '@/components/simulator/default-assumptions';
import GoalSeekPanel from '@/components/simulator/goal-seek-panel';
import YearTable from '@/components/simulator/year-table';
import { simulate } from '@/lib/simulator/engine';
import type { Assumptions } from '@/lib/validation/scenarios';

/**
 * Public wealth-projection simulator client. Mirrors the authed
 * `/simulator` editor's math + UI, with the data wiring deliberately
 * stripped out:
 *
 *   - No `/api/scenarios` POST/PATCH/DELETE — saved scenarios live in
 *     this component's React state only. Refreshing the tab wipes them.
 *   - No `/api/networth` or `/api/derived/cashflow` prefill — the
 *     "Use my actual data" button is absent. The visitor starts from a
 *     blank `defaultAssumptions()` and types every number.
 *   - No `next/navigation` `useRouter` or `router.refresh()` — there's
 *     no server state to revalidate.
 *   - "Save" replaced by an "Export this scenario as JSON" button that
 *     creates a Blob client-side and triggers a download. No network.
 *
 * Imports are restricted to:
 *   - Shared simulator UI under `@/components/simulator/*` (audited
 *     data-free).
 *   - The pure simulation engine `@/lib/simulator/engine`.
 *   - The shared chart component `@/components/charts/simulator-chart`.
 *   - The shared `Assumptions` zod type `@/lib/validation/scenarios`.
 *
 * NO imports from `@/lib/supabase/*`, `@/lib/env.server`, `@/lib/derived/*`,
 * `@/lib/types/scenario` (server-row shape), or any `@/app/api/*` route.
 * Anyone changing this file MUST preserve that — the wall between the
 * public page and the private app is the entire risk surface of this
 * route.
 */

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

/**
 * Trigger a client-side JSON download of the given scenario. Uses Blob +
 * URL.createObjectURL — pure browser API, no network call. The user's
 * browser DevTools network tab should show nothing as a result of clicking
 * the export button.
 */
function downloadScenarioJson(name: string, assumptions: Assumptions): void {
  const payload = JSON.stringify({ name, assumptions }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Slugify the scenario name for the filename. Keep it readable but safe.
  const slug = (name || 'scenario')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  a.download = `${slug || 'scenario'}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke async so the browser has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function PublicSimulatorClient() {
  // In-memory scenarios. NOT persisted to localStorage either — refresh
  // means a clean slate. (Persistence may come later; the public route
  // staying pure is a higher priority for v1.)
  const [scenarios, setScenarios] = useState<ComparableScenario[]>(() => [
    { id: newId(), name: 'Scenario 1', assumptions: defaultAssumptions() },
  ]);
  const [selectedId, setSelectedId] = useState<string>(() => scenarios[0]!.id);
  const [displayMode, setDisplayMode] = useState<'nominal' | 'real'>('nominal');
  const [showTable, setShowTable] = useState(false);
  const [view, setView] = useState<'edit' | 'compare'>('edit');
  const [exportNote, setExportNote] = useState<string | null>(null);

  const current = scenarios.find((s) => s.id === selectedId) ?? scenarios[0]!;
  const assumptions = current.assumptions;

  function patchCurrent(next: Assumptions) {
    setScenarios((arr) =>
      arr.map((s) => (s.id === current.id ? { ...s, assumptions: next } : s)),
    );
  }

  function renameCurrent(nextName: string) {
    setScenarios((arr) =>
      arr.map((s) => (s.id === current.id ? { ...s, name: nextName } : s)),
    );
  }

  function addScenario() {
    const fresh: ComparableScenario = {
      id: newId(),
      name: `Scenario ${scenarios.length + 1}`,
      assumptions: defaultAssumptions(),
    };
    setScenarios((arr) => [...arr, fresh]);
    setSelectedId(fresh.id);
  }

  function duplicateCurrent() {
    const copy: ComparableScenario = {
      id: newId(),
      name: `${current.name} (copy)`.slice(0, 80),
      // Structured clone to avoid sharing the assumptions object across rows.
      assumptions: JSON.parse(JSON.stringify(assumptions)) as Assumptions,
    };
    setScenarios((arr) => [...arr, copy]);
    setSelectedId(copy.id);
  }

  function removeCurrent() {
    if (scenarios.length === 1) return;
    setScenarios((arr) => {
      const next = arr.filter((s) => s.id !== current.id);
      // Re-select something that still exists.
      setSelectedId(next[0]!.id);
      return next;
    });
  }

  function exportCurrent() {
    downloadScenarioJson(current.name, assumptions);
    setExportNote('Downloaded.');
    window.setTimeout(() => setExportNote(null), 2200);
  }

  const result = useMemo(() => {
    try {
      return simulate(assumptions);
    } catch (err) {
      console.warn('[public-simulator] simulate failed', err);
      return null;
    }
  }, [assumptions]);

  const lastNominal = result?.rows[result.rows.length - 1]?.netWorth ?? 0;
  const lastReal =
    result?.rows[result.rows.length - 1]?.netWorthRealTodayDollars ?? 0;
  const firstNominal = result?.rows[0]?.netWorth ?? 0;
  const totalGrowth = firstNominal > 0 ? (lastNominal / firstNominal - 1) * 100 : 0;

  // Markers identical to the authed simulator: a dot per windfall and
  // per active major-expense year on the base line.
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

  if (view === 'compare') {
    return <CompareView scenarios={scenarios} onExit={() => setView('edit')} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="serif-display text-2xl">Wealth Projection Simulator</h1>
        <p className="text-muted text-xs">
          Build a year-by-year projection from your own assumptions. Everything
          runs in your browser — nothing is sent to a server, nothing is saved.
          Refresh the page and your scenarios reset.
        </p>
      </header>

      {/* Scenario selector + name + local-only controls. No save-to-server. */}
      <section className="flex flex-col gap-2">
        <label className="text-muted text-[10px] tracking-[0.18em] uppercase">Scenario</label>
        <select
          className="border-border bg-background rounded border px-3 py-2 text-sm"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <label className="text-muted mt-1 text-[10px] tracking-[0.18em] uppercase">Name</label>
        <input
          type="text"
          value={current.name}
          maxLength={80}
          onChange={(e) => renameCurrent(e.target.value)}
          className="border-border focus:border-foreground rounded border bg-transparent px-3 py-2 text-sm outline-none"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addScenario}
            className="border-border hover:bg-foreground/5 rounded border px-3 py-1.5 text-xs"
          >
            + New scenario
          </button>
          <button
            type="button"
            onClick={duplicateCurrent}
            className="border-border hover:bg-foreground/5 rounded border px-3 py-1.5 text-xs"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={exportCurrent}
            className="border-border hover:bg-foreground/5 rounded border px-3 py-1.5 text-xs"
          >
            Export JSON
          </button>
          {scenarios.length > 1 ? (
            <button
              type="button"
              onClick={removeCurrent}
              className="text-muted hover:text-negative text-xs"
            >
              Remove
            </button>
          ) : null}
          {scenarios.length >= 2 ? (
            <button
              type="button"
              onClick={() => setView('compare')}
              className="text-muted hover:text-foreground text-xs"
            >
              Compare →
            </button>
          ) : null}
          {exportNote ? (
            <span className="text-positive text-[11px]">{exportNote}</span>
          ) : null}
        </div>
      </section>

      {/* Live summary card — same shape as the authed page, minus prefill. */}
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
              className={`px-2.5 py-1 ${
                displayMode === 'nominal' ? 'bg-foreground/10 text-foreground' : 'text-muted'
              }`}
            >
              Nominal
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('real')}
              className={`px-2.5 py-1 ${
                displayMode === 'real' ? 'bg-foreground/10 text-foreground' : 'text-muted'
              }`}
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

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-muted text-[10px] tracking-[0.18em] uppercase">Year by year</p>
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

      <GoalSeekPanel assumptions={assumptions} onChange={patchCurrent} />

      <AssumptionsForm value={assumptions} onChange={patchCurrent} />

      <p className="text-muted text-[10px] italic">
        Estimates based on your assumptions. Not a prediction or financial
        advice. Career-role salaries in the role library are illustrative
        defaults, not market data — replace with your own figures.
      </p>
    </div>
  );
}
