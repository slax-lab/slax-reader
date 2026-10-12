import { copyFileSync, constants, mkdirSync } from 'node:fs'
import { CONFIG_DIR, CONFIG_TEMPLATE } from './config'
import path from 'node:path'
if (process.argv.length !== 2) throw new Error('Usage: pnpm api -- config:init')
try {
  mkdirSync(CONFIG_DIR, { recursive: true })
  copyFileSync(CONFIG_TEMPLATE, path.join(CONFIG_DIR, 'api.toml'), constants.COPYFILE_EXCL)
  console.log('Created deploy/local/api.toml. Configure your own resources and API origin before deployment.')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('api.toml already exists; refusing to overwrite it')
  throw error
}
