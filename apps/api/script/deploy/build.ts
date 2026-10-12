import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { API_ROOT, GENERATED_DIR, parseArgs, readConfig, TARGETS, writeGenerated } from './config'

export function buildWorkers(args: string[] = []): number {
  const options = parseArgs(args)
  const config = readConfig(options.config, options.environment)
  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  const temp = fs.mkdtempSync(path.join(GENERATED_DIR, '.build-'))
  try {
    const empty = path.join(temp, 'empty.vars')
    fs.writeFileSync(empty, '')
    for (const target of options.target ? [options.target] : TARGETS) {
      const generated = writeGenerated(config, target, temp)
      const result = spawnSync(
        'wrangler',
        [
          'deploy',
          path.join(API_ROOT, `src/entry/${target}/index.ts`),
          '--tsconfig',
          path.join(API_ROOT, 'tsconfig.json'),
          '--dry-run',
          '--env-file',
          empty,
          '--config',
          generated,
          '--outdir',
          path.join(GENERATED_DIR, `bundle-${target}`)
        ],
        {
          cwd: API_ROOT,
          stdio: 'inherit',
          env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_SEND_METRICS: 'false' }
        }
      )
      if (result.error) throw result.error
      if (result.status !== 0) return result.status ?? 1
    }
    return 0
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = buildWorkers(process.argv.slice(2))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
