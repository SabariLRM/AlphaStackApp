import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration suites share one Postgres database, so run files sequentially.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
