import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/*.test.ts'],
        },
      },
      {
        // Proves the package verifies in a real browser, not just in Node's
        // WASM host. One fixture end to end is enough to catch a loader or
        // ABI regression; the conformance suite runs in Node.
        test: {
          name: 'browser',
          include: ['test/browser/*.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
