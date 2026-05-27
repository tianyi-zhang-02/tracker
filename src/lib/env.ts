/**
 * Typed environment-variable access with lazy validation.
 *
 * Each property is a getter so that `import { env } from '@/lib/env'` is safe
 * during `next build`'s page-data collection step (which runs without
 * `.env.local`). Validation fires the first time a property is read at
 * runtime; if a required var is missing then, we throw a clear error
 * pointing at `.env.example`.
 *
 * Public vars (those prefixed with NEXT_PUBLIC_) are safe to import anywhere.
 * Server-only vars live in `env.server.ts`.
 */

function readPublic(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill in the value.`,
    );
  }
  return value;
}

type PublicEnv = {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly APP_URL: string;
};

export const env: PublicEnv = {
  get SUPABASE_URL() {
    return readPublic('NEXT_PUBLIC_SUPABASE_URL');
  },
  get SUPABASE_ANON_KEY() {
    return readPublic('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  },
  get APP_URL() {
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  },
};
