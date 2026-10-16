import baseConfig from '../wxt.config.ts'
import { defineConfig } from 'wxt'

export default defineConfig({
  ...baseConfig,
  outDir: process.env.SLAX_PDF_TEST_OUT_DIR || 'build/pdf-popup-e2e',
  manifest: {
    ...baseConfig.manifest,
    host_permissions: baseConfig.manifest.host_permissions
  }
})
