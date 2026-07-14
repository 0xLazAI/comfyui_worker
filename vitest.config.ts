import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run TypeScript sources; never the stale compiled tests under dist/ (gitignored build output).
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
