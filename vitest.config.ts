import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Vitest config for fast unit tests on pure helpers.
//
// Scope is intentionally narrow: only `lib/**/*.test.ts` runs here.
// We deliberately don't pick up route handlers or anything that
// touches Prisma / Anthropic — those belong in the scenario harness
// (tests/scenarios/) which uses the existing simulator infrastructure.
//
// The Next/Node aliasing matches tsconfig so `@/lib/...` imports work
// from inside test files.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
    // Pure tests — no need for the JSDOM polyfill stack.
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
})
