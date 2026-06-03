import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/*.test.ts', 'src/**/*.bench.ts', 'src/**/__tests__/**', 'src/**/__bench__/**'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 }
    }
  }
})
