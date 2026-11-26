import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  nitro: { plugins: [fileURLToPath(new URL('./content-fixture.mjs', import.meta.url))] }
})
