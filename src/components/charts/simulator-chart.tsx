'use client';

import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { SimulationResult, YearRow } from '@/lib/simulator/engine';

export type DisplayMode = 'nominal' | 'real';

type Marker = {
  year: number;
  /** Vertical position on the chart (uses the base line's value). */
  value: number;
  label: string;
  tone: 'windfall' | 'expense';
};

function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

function fmtCurrency0(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

type Point = {
  year: number;
  base: number;
  band: [number, number];
};

function CustomTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
  mode: DisplayMode;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="border-border bg-background/95 rounded border px-2 py-1.5 text-[11px] shadow-lg backdrop-blur">
      <p className="text-muted nums">
        {p.year} · {mode === 'real' ? 'today’s dollars' : 'nominal'}
      </p>
      <p className="nums font-medium">{fmtCurrency0(p.base)}</p>
      <p className="text-muted nums">
        {fmtCurrency0(p.band[0])} – {fmtCurrency0(p.band[1])}
      </p>
    </div>
  );
}

function pickValue(row: YearRow, mode: DisplayMode): number {
  return mode === 'real' ? row.netWorthRealTodayDollars : row.netWorth;
}

export default function SimulatorChart({
  result,
  mode,
  markers,
}: {
  result: SimulationResult;
  mode: DisplayMode;
  markers: Marker[];
}) {
  const data = useMemo<Point[]>(() => {
    return result.rows.map((row, i) => {
      const low = result.low[i]!;
      const high = result.high[i]!;
      return {
        year: row.year,
        base: pickValue(row, mode),
        band: [pickValue(low, mode), pickValue(high, mode)],
      };
    });
  }, [result, mode]);

  if (data.length === 0) {
    return (
      <div className="border-border text-muted flex h-[220px] items-center justify-center rounded border border-dashed text-xs">
        Adjust the horizon to see the projection.
      </div>
    );
  }

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="year"
            tick={{ fill: 'var(--muted)', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tickFormatter={fmtCompact}
            tick={{ fill: 'var(--muted)', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            content={<CustomTooltip mode={mode} />}
            cursor={{ stroke: 'var(--muted)', strokeWidth: 1, strokeDasharray: '2 4' }}
          />
          {/* Low–high band */}
          <Area
            type="monotone"
            dataKey="band"
            stroke="none"
            fill="var(--accent)"
            fillOpacity={0.14}
            isAnimationActive={false}
            activeDot={false}
          />
          {/* Base line */}
          <Line
            type="monotone"
            dataKey="base"
            stroke="var(--accent)"
            strokeWidth={1.25}
            dot={false}
            activeDot={{ r: 3, fill: 'var(--accent)', stroke: 'var(--background)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {markers.map((m, i) => (
            <ReferenceDot
              key={`${m.year}-${i}`}
              x={m.year}
              y={m.value}
              r={3}
              fill={m.tone === 'windfall' ? 'var(--positive)' : 'var(--negative)'}
              stroke="var(--background)"
              strokeWidth={1}
              ifOverflow="visible"
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export type { Marker };
