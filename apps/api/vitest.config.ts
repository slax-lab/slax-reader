import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@/': fileURLToPath(new URL('./src/', import.meta.url)),
      '@test/': fileURLToPath(new URL('./test/', import.meta.url))
    }
  },
  esbuild: {
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } }
  },
  test: {
    include: ['test/**/*.test.ts']
  }
})
