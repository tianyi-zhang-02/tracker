'use client';

import type { YearRow } from '@/lib/simulator/engine';
import type { Person } from '@/lib/validation/scenarios';

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  // Sub-1k numbers can confuse the eye in a column of millions; cap.
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    signDisplay: 'auto',
  }).format(n);
}

export default function YearTable({
  rows,
  people,
  highlightYears,
}: {
  rows: YearRow[];
  people: Person[];
  /** Years to highlight (career switch, windfall, major expense). */
  highlightYears: Set<number>;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="border-border overflow-x-auto rounded border">
      <table className="nums w-full min-w-[640px] text-[11px]">
        <thead className="text-muted text-[10px] tracking-wide uppercase">
          <tr className="border-border border-b">
            <th className="px-2 py-2 text-left">Year</th>
            {people.length > 0 ? <th className="px-2 py-2 text-left">Ages</th> : null}
            <th className="px-2 py-2 text-right">Gross</th>
            <th className="px-2 py-2 text-right">After tax</th>
            <th className="px-2 py-2 text-right">Expenses</th>
            <th className="px-2 py-2 text-right">Windfalls</th>
            <th className="px-2 py-2 text-right">Saved</th>
            <th className="px-2 py-2 text-right">Growth</th>
            <th className="px-2 py-2 text-right">Net worth</th>
            <th className="px-2 py-2 text-right">Real</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hot = highlightYears.has(r.year);
            return (
              <tr
                key={r.year}
                className={`border-border border-b last:border-b-0 ${hot ? 'bg-foreground/[0.03]' : ''}`}
              >
                <td className="px-2 py-1.5 text-left">{r.year}</td>
                {people.length > 0 ? (
                  <td className="text-muted px-2 py-1.5 text-left">
                    {people.map((p) => r.ages[p.id] ?? 0).join(' / ')}
                  </td>
                ) : null}
                <td className="px-2 py-1.5 text-right">{fmt(r.grossIncome)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.afterTaxIncome)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.expenses)}</td>
                <td
                  className={`px-2 py-1.5 text-right ${r.windfalls > 0 ? 'text-positive' : 'text-muted'}`}
                >
                  {r.windfalls === 0 ? '—' : fmt(r.windfalls)}
                </td>
                <td
                  className={`px-2 py-1.5 text-right ${r.saved < 0 ? 'text-negative' : ''}`}
                >
                  {fmt(r.saved)}
                </td>
                <td className="text-muted px-2 py-1.5 text-right">{fmt(r.investmentGrowth)}</td>
                <td className="px-2 py-1.5 text-right font-medium">{fmt(r.netWorth)}</td>
                <td className="text-muted px-2 py-1.5 text-right">
                  {fmt(r.netWorthRealTodayDollars)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
