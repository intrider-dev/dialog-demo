import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/test/**/*.test.ts', 'scripts/**/*.test.mjs'],
          testTimeout: 15000,
          hookTimeout: 15000,
        },
      },
      {
        resolve: { alias: { '@': fileURLToPath(new URL('./client/src', import.meta.url)) } },
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['client/test/**/*.test.ts', 'client/test/**/*.test.tsx'],
          setupFiles: ['client/test/setup.ts'],
          testTimeout: 10000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: [
        'server/src/**/*.ts',
        'client/src/**/*.ts',
        'client/src/**/*.tsx',
        'scripts/setup.mjs',
      ],
      exclude: ['client/src/main.tsx', 'server/src/index.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { statements: 95, branches: 90, functions: 98, lines: 98 },
    },
  },
})
