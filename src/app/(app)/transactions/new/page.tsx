import Link from 'next/link';

export default function NewTransactionPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 px-6 pt-10">
      <header>
        <h1 className="serif-display text-3xl">Add transaction</h1>
        <p className="text-muted mt-2 text-sm">
          The + button in the bottom nav routes here for now. Step 6 turns this into a proper modal.
        </p>
      </header>
      <Link
        href="/transactions"
        className="border-border text-muted hover:text-foreground self-start rounded border px-3 py-1.5 text-xs"
      >
        ← Back to transactions
      </Link>
    </main>
  );
}
