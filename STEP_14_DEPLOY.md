# Step 14 — Deploy to Vercel

Operator checklist for taking `tracker` live. Walk through it top to bottom; do not skip the verification commands.

> **No `vercel.json` is required.** Next 16's official docs (`01-getting-started/17-deploying.md`) list Vercel as a "verified adapter" with full feature support and zero special config. Our app uses standard `next build` / `next start`, the proxy uses only universal APIs (`crypto.randomUUID`, `Buffer`, `fetch`) so Edge runtime works fine, and we don't need region pinning, memory tuning, or function-timeout overrides. If a future feature ever needs one of those, add `vercel.json` then — not now.

---

## 0. Pre-flight (5 min)

- [ ] On `main`, working tree clean: `git status`
- [ ] Build succeeds locally: `npm run build`
- [ ] Tests pass: `npm test`
- [ ] Lint clean: `npm run lint`
- [ ] `npm audit` shows 0 high / 0 critical (Step 13 brought it to 0/0/0)
- [ ] Decide: **one Supabase project** (dev = prod, simplest) or **separate dev + prod projects** (cleaner blast radius). See §3 for the implications.

---

## 1. Decide on the production URL

The CSP `connect-src` and the Origin allowlist (`isAllowedOrigin`) both depend on `NEXT_PUBLIC_APP_URL` matching the actual production host exactly. Pick **one** of:

- [ ] **Vercel default** — accept `https://tracker-<hash>.vercel.app` or `https://<project-name>.vercel.app`. Free, instant, no DNS.
- [ ] **Custom domain** — buy/use a domain you own; add it in Vercel under Project → Domains. Vercel handles TLS automatically.

Whichever you pick, write it down now — you'll paste it in §4 (Vercel env), §5 (Supabase Auth), and as the value of `NEXT_PUBLIC_APP_URL`.

---

## 2. Vercel project setup (5 min)

If you already have a Vercel account linked to the GitHub `tianyi-zhang-02` org/user:

- [ ] Vercel dashboard → **Add New… → Project**
- [ ] Import `tianyi-zhang-02/tracker`
- [ ] Framework preset: **Next.js** (auto-detected, leave as-is)
- [ ] Root directory: `./` (leave as-is)
- [ ] Build command: leave default (`next build`)
- [ ] Output directory: leave default (`.next`)
- [ ] Install command: leave default (`npm install`)
- [ ] Node version: **20.x** or newer (Vercel auto-detects from `engines`/lockfile; verify it's not on 18 — Next 16 wants ≥ 20)
- [ ] **Don't deploy yet** — env vars next, then trigger build.

If you don't have a Vercel account yet, create one at `vercel.com` (free Hobby tier is enough), authorize GitHub, then continue.

---

## 3. Supabase project decision

**Option A — one project (recommended for personal use).** Your existing Supabase project is both dev and prod. The migration 0002 you already applied is therefore already in prod. Lower setup overhead, but a dev mistake (e.g., `delete from accounts;` in the SQL editor without `where`) destroys prod data. Mitigations: never run destructive SQL outside of a transaction; rely on Supabase point-in-time recovery (Pro plan only, otherwise daily backups on Hobby).

**Option B — separate prod project.** Spin up a second Supabase project just for production. Cleaner blast radius. Requires re-running `supabase/schema.sql` and migration `0002_revoke_rls_auto_enable_grants.sql` in the new project, plus separate API keys, plus a way to switch between them locally (you'd keep two `.env.local` profiles).

For the rest of this checklist I assume **Option A** unless flagged.

---

## 4. Vercel environment variables (10 min) ⚠️ secrets

Go to **Project Settings → Environment Variables** in Vercel. Add the following, scoped to **Production** (and **Preview** if you want preview deploys to also work — fine since they hit the same Supabase). Do **not** mark any as exposed in the build log.

| Name | Source | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | Already in your local `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | Already in your local `.env.local` |
| `NEXT_PUBLIC_APP_URL` | from §1 | **Exact** scheme + host + no trailing slash. E.g. `https://tracker.example.com` or `https://tracker-xyz.vercel.app` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role | Server-only, never exposed |
| `ALPHAVANTAGE_API_KEY` | alphavantage.co | **No underscore** between `ALPHA` and `VANTAGE`. The code reads exactly this name in `src/lib/env.server.ts:32` |

**Verify after entering:** the Vercel UI should show 5 vars, all scoped to Production. The two `NEXT_PUBLIC_*` ones get embedded in the client bundle (intentional and safe — they're meant to be public). The other three never reach the browser.

---

## 5. Supabase Auth configuration (5 min)

Two settings must be updated for the magic-link flow to work in production:

- [ ] **Site URL.** Supabase → Authentication → URL Configuration → Site URL. Set to the production URL from §1 (e.g. `https://tracker.example.com`). This is the default that magic links redirect to.
- [ ] **Redirect URLs.** Same page → "Redirect URLs". **Add** the production URL(s) without removing localhost:
  - `http://localhost:3000/auth/confirm` ← keep for local dev
  - `https://your-prod-url/auth/confirm` ← add this
- [ ] **Email template.** Supabase → Authentication → Email Templates → "Magic Link". Confirm the body uses `{{ .Token }}` (8-digit OTP flow), not `{{ .ConfirmationURL }}`. (This was settled during Step 3; verify it's still right.)
- [ ] **Leaked-password protection.** Skip — formally deferred per CLAUDE.md known-debt #3 (magic-link only).

---

## 6. Verify migration 0002 is applied to the production DB

Critical because the SECURITY DEFINER grant fix lives in this migration, not in `schema.sql`. **If you're on Option A (one project)** you applied it during Step 13 review and it's already in prod. **If you're on Option B (separate prod project)** you have **not** applied it yet.

### Method 1 — Supabase Security Advisor (visual)

- [ ] Supabase dashboard → Advisors → Security
- [ ] **Pass:** "Function search_path mutable" warnings #1 and #2 about `rls_auto_enable` are **absent**
- [ ] **Fail:** if either warning is present, the migration has not been applied to this project. Run §6.3 to apply, then re-check.

### Method 2 — pg_proc grants query (programmatic)

Supabase → SQL Editor, run:

```sql
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name = 'rls_auto_enable';
```

- [ ] **Pass:** result contains `service_role` (and possibly `postgres`/`supabase_admin`) and does **not** contain `anon` or `authenticated`.
- [ ] **Pass also:** result is **empty** (means the helper doesn't exist on this project at all — also safe; the migration's `DO` block would've been a no-op).
- [ ] **Fail:** result contains `anon` or `authenticated`. Run §6.3 to apply.

### 6.3 Apply migration 0002 (only if §6.1 or §6.2 failed)

- [ ] Supabase → SQL Editor → New query → paste the **entire** contents of `supabase/migrations/0002_revoke_rls_auto_enable_grants.sql`
- [ ] Run. Expect "Success. No rows returned." or similar.
- [ ] Re-run §6.1 or §6.2 to confirm the warning cleared.

---

## 7. Trigger the first production deploy (5 min)

- [ ] Vercel dashboard → Project → Deployments → **Deploy** (or just push to `main` — Vercel auto-deploys).
- [ ] Watch the build log. Expected: typecheck + lint + build all pass, no env-var errors. **Build should be ~2-3 minutes.**
- [ ] If the build fails with "Missing required environment variable: X", you forgot one in §4. Add it, redeploy.
- [ ] Open the production URL when the deploy is green.

---

## 8. Post-deploy smoke tests (10 min)

Walk through these in the prod browser. Open DevTools Network + Console.

### 8.1 — Headers (no auth required)

- [ ] `curl -sI https://<prod-url>/login` returns:
  - [ ] `HTTP/2 200`
  - [ ] `content-security-policy: default-src 'self'; script-src 'self' 'nonce-...` (full strict policy from Step 13)
  - [ ] `strict-transport-security: max-age=31536000; includeSubDomains`
  - [ ] `x-frame-options: DENY`
  - [ ] `x-content-type-options: nosniff`
  - [ ] `referrer-policy: same-origin`
  - [ ] `permissions-policy: accelerometer=(), camera=(), ...`
- [ ] `curl -sI https://<prod-url>/api/accounts` returns `HTTP/2 307` redirect to `/login` (unauthenticated). Static security headers still present; no CSP (expected, we skip CSP on `/api/*`).

### 8.2 — Auth round-trip

- [ ] Open `https://<prod-url>/login` in a fresh browser window (incognito helps).
- [ ] Enter your email, get the 8-digit OTP from email, paste, sign in. Should land on `/`.
- [ ] If redirect fails or email lands in spam, recheck §5 (Site URL + Redirect URLs).

### 8.3 — Core flows under prod CSP

In DevTools Console, **watch for "Refused to execute" or "Refused to apply" CSP errors**. Any of these means a real bug we need to fix before declaring done.

- [ ] Dashboard loads, net-worth tile renders, sparkline chart visible
- [ ] `/portfolio` loads, holdings table renders, click "Refresh prices" — toast appears, values update
- [ ] `/simulator` loads, scenario form renders, line chart renders without console warnings
- [ ] `/goals` loads, progress bars visible (inline `style={width:...}` should work via `style-src-attr`)
- [ ] `/transactions` loads, filter dropdowns work, "Add" form opens
- [ ] PWA install — on mobile, "Add to Home Screen" works; icon shows the warm-gold square

### 8.4 — Secret-leak grep on the prod bundle

```bash
# From your laptop, after the deploy is live:
curl -s https://<prod-url>/_next/static/chunks/main-*.js -o /tmp/prod-chunk.js 2>/dev/null
# Or just verify locally that no service-role JWT prefix appears in the bundle:
grep -rE 'eyJ[A-Za-z0-9_-]{50,}' .next/static  # should still be 0 hits
```

If you want to be paranoid: spot-check the deployed HTML source view for the dashboard — verify no `SUPABASE_SERVICE_ROLE_KEY` or `ALPHAVANTAGE_API_KEY` substring appears anywhere.

---

## 9. After deploy

- [ ] In `CLAUDE.md`, update the **Project** block: replace `**Live URL:** (Vercel — TBD)` with the actual URL.
- [ ] Mark Step 14 ✅ in "Current State" with the deploy date and final URL.
- [ ] Optionally squash the now-redundant `docs/mark-polish-complete` and `polish/integration` remote branches; they served their purpose.
- [ ] **Backup verification.** From `/settings/export`, download the encrypted JSON backup using your real passphrase, then re-import it (read-only) to confirm round-trip. This is the user-facing disaster-recovery path — exercising it once on real prod data is worth the 60 seconds.

---

## 10. Roll-back plan

If something is broken on prod:

- [ ] Vercel → Deployments → click the previous green deploy → **Promote to Production**. Takes ~30 seconds, no DB changes.
- [ ] If the issue is a bad commit on `main`, revert with `git revert <SHA>` and push — Vercel redeploys automatically.
- [ ] **Never** force-push to main. Use revert.
- [ ] If env-var corruption: re-enter from §4, redeploy.
- [ ] If migration 0002 caused a problem (unlikely — it only revokes grants): the migration is idempotent and reversible by re-granting; but Supabase doesn't roll back DB migrations automatically, so be deliberate.

---

## Outstanding questions for the operator (you)

1. **Custom domain or `*.vercel.app`?** Pick one in §1 before §4.
2. **Option A (one Supabase project) or Option B (separate prod project)?** §3 — affects §6 verification path.
3. After deploy, do you want me to update CLAUDE.md and add a `feat: deploy` commit on `main`, or do you want to do that yourself?
