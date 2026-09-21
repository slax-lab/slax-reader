import baseConfig from './config/uno.base'
import { defineConfig, mergeConfigs } from 'unocss'

export default defineConfig(mergeConfigs([baseConfig, {}]))
