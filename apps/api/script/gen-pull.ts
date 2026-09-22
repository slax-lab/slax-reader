import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_ROOT } from './root'

export function pullSchema(args = process.argv.slice(2)): number {
  const [target] = args
  if (args.length !== 1 || (target !== 'pgsql' && target !== 'logs')) {
    throw new Error('usage: pnpm api -- gen:pull <pgsql|logs>')
  }
  const result = spawnSync('prisma', ['db', 'pull', '--config', path.join(API_ROOT, `prisma/${target}.config.ts`)], {
    cwd: API_ROOT,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = pullSchema()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
