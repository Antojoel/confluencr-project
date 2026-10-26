import { defineConfig } from 'vitest/config';

// Tests truncate tables, so default to the dedicated test database, never the dev one.
process.env.DATABASE_URL ??= 'postgres://ledger:ledger@localhost:5432/ledger_test';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // Test files share one database, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
