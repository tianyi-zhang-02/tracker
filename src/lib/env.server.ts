import 'server-only';

/**
 * Server-only environment variables. The `server-only` import will throw at
 * build time if a client component transitively imports this module.
 *
 * Like `env.ts`, validation is lazy (getter-based) so `next build` succeeds
 * even when `.env.local` hasn't been provisioned yet.
 */

function readServer(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required server environment variable: ${name}. ` +
        `Set it in .env.local (locally) or in Vercel project settings (production).`,
    );
  }
  return value;
}

type ServerEnv = {
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  // ALPHA_VANTAGE_API_KEY is added in Step 9.
};

export const serverEnv: ServerEnv = {
  get SUPABASE_SERVICE_ROLE_KEY() {
    return readServer('SUPABASE_SERVICE_ROLE_KEY');
  },
};
