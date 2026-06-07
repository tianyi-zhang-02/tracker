import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Match tsconfig.json's `@/*` → `./src/*` alias so test files can
    // import simulator code with the same paths the app uses.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      // Migration logic-verification tests live next to the SQL they
      // verify — keeps the assertion and the SQL change in the same
      // diff, in the same folder, where a reviewer expects to find them.
      'supabase/**/*.test.ts',
    ],
    environment: 'node',
    globals: false,
  },
});
