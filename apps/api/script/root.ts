import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
export const API_ROOT = path.join(ROOT, 'apps/api')
export const API_TSCONFIG = path.join(API_ROOT, 'tsconfig.json')

export const LOCAL_DIR = path.join(ROOT, 'deploy/local')
