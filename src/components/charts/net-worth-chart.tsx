'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type ChartPoint = {
  /** YYYY-MM-DD (month-end). */
  month_end: string;
  total: number;
};

function formatMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(d);
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint; value: number }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload;
  return (
    <div className="border-border bg-background/95 rounded border px-2 py-1.5 text-[11px] shadow-lg backdrop-blur">
      <p className="text-muted nums">
        {new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(new Date(`${point.month_end}T00:00:00`))}
      </p>
      <p className="nums font-medium">{formatCurrency(point.total)}</p>
    </div>
  );
}

export default function NetWorthChart({ data }: { data: ChartPoint[] }) {
  if (data.length === 0 || data.every((p) => p.total === 0)) {
    return (
      <div className="border-border text-muted flex h-[180px] items-center justify-center rounded border border-dashed text-xs">
        Add a snapshot to start the trend line.
      </div>
    );
  }

  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="month_end"
            tickFormatter={formatMonth}
            tick={{ fill: 'var(--muted)', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            tickFormatter={(v: number) =>
              new Intl.NumberFormat('en-US', {
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format(v)
            }
            tick={{ fill: 'var(--muted)', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: 'var(--muted)', strokeWidth: 1, strokeDasharray: '2 4' }}
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--accent)"
            strokeWidth={1}
            dot={false}
            activeDot={{ r: 3, fill: 'var(--accent)', stroke: 'var(--background)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
