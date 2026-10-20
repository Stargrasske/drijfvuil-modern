import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Nest's schema builder uses GraphQL's Node entry; avoid a second ESM realm in tests.
  resolve: {
    alias: [{ find: /^graphql$/, replacement: createRequire(import.meta.url).resolve('graphql') }],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'api',
          environment: 'node',
          include: ['apps/api/**/*.test.ts', 'libs/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/**/*.test.{ts,tsx}'],
          setupFiles: ['apps/web/src/test-setup.ts'],
        },
      },
    ],
  },
});
