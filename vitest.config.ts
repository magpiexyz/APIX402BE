import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Include test files
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],

    // Exclude node_modules
    exclude: ['node_modules', 'dist'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/index.ts', // Main entry point - integration tested separately
      ],
      // Thresholds - increase as more tests are added
      // Current: firestoreTokenService at 100% coverage
      thresholds: {
        statements: 5,
        branches: 5,
        functions: 7,
        lines: 5,
      },
    },

    // Global test timeout
    testTimeout: 10000,

    // Reporter for CI
    reporters: ['verbose'],
  },
});
