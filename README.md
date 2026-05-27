# Tracker

A personal, mobile-first PWA for tracking net worth, income, savings goals, and a manually-entered investment portfolio with live market prices. Built for one user — no sharing, no bank linking, no analytics. Just numbers and charts that feel like a private banking app.

> Stack: Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Auth) · Tailwind v4 · Recharts · Alpha Vantage (free tier) · Deployed on Vercel.

## Security model

**This repo is public.** The threat model assumes a stranger reads every line of code and tries to break in. The codebase is structured around these invariants:

- **All database access is server-side.** The browser never imports the Supabase client; it talks to Next.js API routes under `/app/api/*`. The `SUPABASE_SERVICE_ROLE_KEY` lives only on the server.
- **Row Level Security is enabled on every user table** (`auth.uid() = user_id`) as defense in depth.
- **Auth is magic link only** (Supabase email OTP). No passwords, no OAuth providers.
- **The Alpha Vantage key is server-only.** The browser hits `/api/quotes`; the server proxies and caches via the `price_cache` table to stay inside the free tier (25 calls/day).
- **CSP headers, Origin-header CSRF checks on mutations, zod validation on every input.**
- **No third-party scripts, no client-side analytics.**
- **Pre-commit secret scanning** (gitleaks) blocks accidental key commits.

See `CLAUDE.md` for the full hard-rule list.

## Setup

You'll need Node 20+, npm, a Supabase project, and an Alpha Vantage API key.

```bash
# 1. Clone & install
git clone https://github.com/yrqoeuqo123/tracker.git
cd tracker
npm install

# 2. Configure environment
cp .env.example .env.local
# Then fill in the values — see "Provisioning" below.

# 3. Run the database migration
# In the Supabase SQL editor, paste and run the contents of supabase/schema.sql

# 4. Start the dev server
npm run dev
# → http://localhost:3000
```

### Provisioning

**Supabase** — create a project at [supabase.com](https://supabase.com). From _Project Settings → API_, copy:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` _(never expose this to the browser)_

Enable email auth (it's on by default). In _Authentication → URL Configuration_, set the site URL to `http://localhost:3000` for dev (and your production URL once deployed).

**Alpha Vantage** — get a free key at [alphavantage.co/support/#api-key](https://www.alphavantage.co/support/#api-key). Instant, no credit card. Set as `ALPHAVANTAGE_API_KEY`.

## Scripts

| Command                | What it does                         |
| ---------------------- | ------------------------------------ |
| `npm run dev`          | Start dev server on `localhost:3000` |
| `npm run build`        | Production build                     |
| `npm run start`        | Run the production build             |
| `npm run lint`         | ESLint                               |
| `npm run typecheck`    | TypeScript type-check (no emit)      |
| `npm run format`       | Prettier write                       |
| `npm run format:check` | Prettier check (CI-friendly)         |

## Deployment

Vercel: import the repo, set the same four env vars as `.env.local`, deploy. Update Supabase's _Authentication → URL Configuration_ with the production domain so magic-link redirects work.

## License

MIT — see [LICENSE](LICENSE).
