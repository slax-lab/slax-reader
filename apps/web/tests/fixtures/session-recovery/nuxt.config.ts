import { fileURLToPath } from 'node:url'

// Opt-in test layer: pnpm web -- dev --port 3217 --extends ./tests/fixtures/session-recovery
export default defineNuxtConfig({
  vite: { server: { hmr: false } },
  nitro: { plugins: [fileURLToPath(new URL('./content-fixture.mjs', import.meta.url))] }
})
