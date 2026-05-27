export default function PortfolioPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 px-6 pt-10">
      <header>
        <h1 className="serif-display text-3xl">Portfolio</h1>
        <p className="text-muted mt-2 text-sm">
          Holdings with live prices from Alpha Vantage, P/L, and day change. Lands in Step 9.
        </p>
      </header>
      <section className="border-border text-muted rounded border p-4 text-sm">
        Placeholder — holdings + Alpha Vantage proxy coming up.
      </section>
    </main>
  );
}
