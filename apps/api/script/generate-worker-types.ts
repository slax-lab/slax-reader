import { API_ROOT } from './root'
import { CONFIG_PATH, parseArgs, selectEnvironment } from './deploy/config'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'smol-toml'
import ts from 'typescript'

const RUNTIME_MARKER = '// Begin runtime types'

export function environmentTypes(source: string): string {
  const marker = source.indexOf(RUNTIME_MARKER)
  if (marker < 0) throw new Error('Worker runtime types marker is missing')
  const env = source.slice(0, marker)
  const ast = ts.createSourceFile('worker-configuration.d.ts', env, ts.ScriptTarget.Latest, true)
  const check = (node: ts.Node) => {
    if (ts.isPropertySignature(node) && node.type) {
      const checkType = (type: ts.Node) => {
        if (ts.isImportTypeNode(type)) return
        if (ts.isLiteralTypeNode(type)) throw new Error('Environment bindings must not contain literal configuration values')
        ts.forEachChild(type, checkType)
      }
      if (ts.isIdentifier(node.name) && /^[A-Z][A-Z0-9_]*$/.test(node.name.text)) checkType(node.type)
    }
    ts.forEachChild(node, check)
  }
  check(ast)
  return env.replace(/^\/\/ Runtime types generated.*\n/m, '')
}

export function generateWorkerTypes(root = API_ROOT, runtimeConfig = CONFIG_PATH, environment = process.env.SLAX_API_ENV): void {
  if (!fs.existsSync(runtimeConfig)) throw new Error('API configuration is missing. Run pnpm api -- config:init first.')
  const output = path.join(root, 'worker-configuration.d.ts')
  const env = environmentTypes(fs.readFileSync(output, 'utf8'))
  const config = selectEnvironment(parse(fs.readFileSync(runtimeConfig, 'utf8')), environment)
  const temp = fs.mkdtempSync(path.join(root, '.worker-types-'))
  try {
    const configPath = path.join(temp, 'wrangler.toml')
    const envPath = path.join(temp, 'empty.vars')
    const runtimePath = path.join(temp, 'runtime.d.ts')
    fs.writeFileSync(envPath, '')
    fs.writeFileSync(
      configPath,
      stringify({
        name: 'worker-runtime-types',
        compatibility_date: config.compatibility_date,
        compatibility_flags: config.compatibility_flags
      })
    )
    const result = spawnSync('wrangler', ['types', runtimePath, '--config', configPath, '--include-env=false', '--strict-vars=false', '--env-file', envPath], {
      cwd: temp,
      stdio: 'inherit',
      env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_SEND_METRICS: 'false' }
    })
    if (result.error || result.status !== 0) throw new Error('Worker runtime type generation failed')
    const runtime = fs.readFileSync(runtimePath, 'utf8')
    const marker = runtime.indexOf(RUNTIME_MARKER)
    if (marker < 0) throw new Error('Generated worker runtime types marker is missing')
    fs.writeFileSync(output, env + runtime.slice(marker))
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  if (options.target) throw new Error('Usage: pnpm api -- types [--config <path>]')
  generateWorkerTypes(API_ROOT, options.config, options.environment)
}
