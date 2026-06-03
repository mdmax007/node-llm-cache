import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/client.ts',
        'src/**/*.test.ts',
        'src/**/*.integration.test.ts',
        'src/**/__tests__/**'
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 }
    }
  }
})
