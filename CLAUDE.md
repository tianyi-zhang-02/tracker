@AGENTS.md

# Wealth Tracker — project conventions

A personal mobile-first PWA for tracking net worth, income, savings, and a manually-entered investment portfolio with live prices. Stack: Next.js 16 (App Router) + Supabase + Vercel. The full build spec lives in the original session prompt.

## Hard rules (security model)

This is a **public GitHub repo**. Assume hostile readers. Every change must hold these invariants:

1. **No Supabase calls from the browser.** Every database read/write goes through `/app/api/*` route handlers. The browser never imports `@supabase/supabase-js` directly.
2. **`SUPABASE_SERVICE_ROLE_KEY` is server-only.** Never reference it in a file that could be imported by client code. Use `import 'server-only'` at the top of server-only modules.
3. **RLS is enabled on every user table** (`auth.uid() = user_id`) as defense in depth.
4. **Every API route**: (a) verifies the session, (b) validates input with zod, (c) checks the `Origin` header on mutating verbs, (d) returns generic error messages — no stack traces, no DB error strings.
5. **Alpha Vantage key is server-only.** The browser hits `/api/quotes`; the server proxies and caches via the `price_cache` table.
6. **No third-party scripts. No client-side analytics.** Period.
7. **No secrets in the repo, ever.** `.env.example` only. Pre-commit hook (gitleaks, added in step 13) blocks accidental commits.

## Stack conventions

- **Package manager:** npm (not pnpm — `package-lock.json` is the source of truth).
- **TypeScript:** strict mode. Prefer `unknown` over `any`. Validate at boundaries with zod.
- **Styling:** Tailwind v4 with `@theme` in `globals.css`. Accent color is warm gold `#d4a574`; background `#0a0a0a`; foreground `#f5f1ea`. Numbers use `font-variant-numeric: tabular-nums`.
- **Forms:** react-hook-form + `@hookform/resolvers/zod`.
- **Charts:** recharts. Thin 1px lines, no chart junk.
- **Data fetching:** server components for reads where possible; route handlers for mutations.

## Out of scope — do not suggest

Plaid/bank linking, multi-user, tax reporting, automated trade import, budgeting limits, notifications, third-party analytics.

## Next.js 16 reminder

The pre-existing `AGENTS.md` note applies: this is Next.js 16 and APIs may differ from older training data. When in doubt, read `node_modules/next/dist/docs/` before writing route handlers, middleware, or config.
