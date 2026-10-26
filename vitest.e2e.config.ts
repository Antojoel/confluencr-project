import { defineConfig } from 'vitest/config';

// Black-box tests against a running API; no database access, so no global setup.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    testTimeout: 20_000,
  },
});
