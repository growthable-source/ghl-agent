import { defineConfig } from 'vitest/config'

// Own config so vitest doesn't inherit the parent Next app's
// (which restricts tests to lib/**/*.test.ts).
export default defineConfig({
  root: __dirname,
  test: {
    include: ['test/**/*.test.ts'],
  },
})
