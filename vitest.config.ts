import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      restoreMocks: true,
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'jsdom',
            globals: true,
            include: ['src/**/*.test.{ts,tsx}'],
            setupFiles: ['./tests/setup/vitest.setup.ts'],
            env: {
              // Placeholder env for modules that read config at import time. Never real keys.
              VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
              VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit-test-placeholder',
            },
          },
        },
        {
          extends: true,
          test: {
            name: 'integration',
            environment: 'node',
            include: ['tests/integration/**/*.int.test.ts'],
            globalSetup: ['./tests/setup/integration.global-setup.ts'],
            testTimeout: 30_000,
            hookTimeout: 60_000,
            // Shared local database: run files sequentially to avoid cross-test interference.
            fileParallelism: false,
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/app/entrypoint/main.tsx',
          'src/shared/api/database.types.ts',
        ],
      },
    },
  }),
)
