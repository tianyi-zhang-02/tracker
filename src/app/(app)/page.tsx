import { getAuthedUser } from '@/lib/supabase/server';

/**
 * Dashboard placeholder. Step 7 (snapshots + net-worth chart) replaces this
 * with the real at-a-glance + 12-month line chart.
 */
export default async function DashboardPage() {
  const user = await getAuthedUser();

  return (
    <main className="flex flex-1 flex-col gap-8 px-6 pt-10">
      <header className="space-y-2">
        <p className="text-muted text-[11px] tracking-[0.2em] uppercase">Net worth</p>
        <p className="serif-display text-foreground nums text-5xl">$ —</p>
        <p className="text-muted text-xs">
          Add accounts and a month-end snapshot to populate this number.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <Stat label="Liquid" value="$ —" />
        <Stat label="Invested" value="$ —" />
      </section>

      <section className="border-border rounded border p-4">
        <p className="text-muted text-xs">Signed in as {user?.email}.</p>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border rounded border p-4">
      <p className="text-muted text-[10px] tracking-[0.18em] uppercase">{label}</p>
      <p className="serif-display nums mt-2 text-2xl">{value}</p>
    </div>
  );
}
