import { fileURLToPath } from 'node:url'

// Opt-in layer; synthetic backend bindings never enter the shipped application.
export default defineNuxtConfig({
  vite: { server: { hmr: false } },
  plugins: [fileURLToPath(new URL('./plugins/seed.client.ts', import.meta.url))],
  nitro: { plugins: [fileURLToPath(new URL('./content-fixture.mjs', import.meta.url))] }
})
