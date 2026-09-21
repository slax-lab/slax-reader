import path from 'node:path'

export default {
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src')
    }
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
}
