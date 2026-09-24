import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_PATH, readConfig } from './config'
import { checkDevelopment } from './setup-api'

/** Return only safe status flags; validator errors can contain operator values. */
export function checkReadiness(filename = CONFIG_PATH, environment = process.env.SLAX_API_ENV): { startup: boolean; local: boolean } {
  try {
    readConfig(filename, environment, true)
  } catch {
    return { startup: false, local: false }
  }
  try {
    checkDevelopment(filename, environment)
    return { startup: true, local: true }
  } catch {
    return { startup: true, local: false }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(checkReadiness()))
}
