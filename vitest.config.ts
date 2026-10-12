import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests for the pure utilities (show package, coercion, validation). They import each other
// explicitly: Nuxt auto-imports are not available here.
export default defineConfig({
  resolve: {
    alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) }
  },
  test: {
    environment: 'node',
    include: ['app/**/__tests__/**/*.test.ts']
  }
})
