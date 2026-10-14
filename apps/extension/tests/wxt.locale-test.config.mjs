import baseConfig from '../wxt.config.ts'
import { defineConfig } from 'wxt'
export default defineConfig({ ...baseConfig, outDir: 'build/locale-e2e' })
