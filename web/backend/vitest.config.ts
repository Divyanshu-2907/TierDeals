import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Migrates the test database once per run.
    globalSetup: ['./test/global-setup.ts'],
    // src/config/env.ts validates process.env at import time, so a valid
    // environment has to exist before any src module is loaded.
    setupFiles: ['./test/setup-env.ts'],
    globals: false,
    restoreMocks: true,
  },
});
