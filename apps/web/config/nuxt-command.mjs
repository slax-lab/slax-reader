/**
 * Run Nuxt with the repository's canonical deploy environment.
 *
 * Nuxt's c12 loader runs before nuxt.config.ts and otherwise discovers
 * apps/web/.env.  Passing a generated empty dotenv file prevents that
 * discovery while still allowing Nuxt to initialise normally. Values are
 * loaded by tooling/env-files.mjs first, with process > profile > base
 * precedence.
 */
import { pnpmInvocation } from '../../../tooling/pnpm-command.mjs'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDeployEnvironment } from '../../../tooling/env-files.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(appRoot, '../..')
applyDeployEnvironment({ appName: 'web', root: repoRoot })

const commandArgs = process.argv.slice(2)
const command = commandArgs.shift()
if (!command || command === '--help' || command === '-h') {
  console.error('用法：node config/nuxt-command.mjs <prepare|dev|build|generate|preview|typecheck> [参数]')
  process.exit(command ? 0 : 2)
}

// Do not let a package-script caller re-enable cwd dotenv discovery.
const forwarded = []
for (let index = 0; index < commandArgs.length; index += 1) {
  const argument = commandArgs[index]
  if (argument === '--dotenv') {
    index += 1
    continue
  }
  if (argument.startsWith('--dotenv=')) continue
  forwarded.push(argument)
}

const invocation = pnpmInvocation(['exec', 'nuxt', command])
const tempDirectory = mkdtempSync(resolve(tmpdir(), 'slax-reader-nuxt-'))
const emptyEnvFile = resolve(tempDirectory, '.env')
writeFileSync(emptyEnvFile, '')
const child = spawn(invocation.program, [...invocation.args, '--dotenv', emptyEnvFile, ...forwarded], {
  cwd: appRoot,
  env: process.env,
  stdio: 'inherit'
})

let interrupted
const stop = signal => {
  interrupted = signal
  if (child.pid) child.kill(signal)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

const cleanup = () => rmSync(tempDirectory, { recursive: true, force: true })
child.on('error', error => {
  cleanup()
  console.error(`Nuxt 启动失败：${error.message}`)
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  cleanup()
  const reason = interrupted || signal
  process.exitCode = reason ? 128 + ({ SIGINT: 2, SIGTERM: 15 }[reason] || 1) : code ?? 1
})
