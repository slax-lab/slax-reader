import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { constants } from 'node:os'
import { fileURLToPath } from 'node:url'
import { pnpmInvocation } from './pnpm-command.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('../apps/cli/package.json', import.meta.url), 'utf8'))
const commands = ['build', 'dev', 'start', 'typecheck', 'test', 'test:package'].filter(command => Object.hasOwn(manifest.scripts, command))
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()
const command = args.shift()
if (!command || ['help', '-h', '--help'].includes(command)) {
  console.log(`Usage: pnpm cli -- <command> [arguments]\n\n${commands.join('\n')}`)
  process.exitCode = command ? 0 : 2
} else if (!commands.includes(command)) {
  console.error(`Unknown CLI command: ${command}. Run pnpm cli -- --help.`)
  process.exitCode = 2
} else {
  const invocation = pnpmInvocation(['--filter', manifest.name, 'run', command, ...args])
  const grouped = process.platform !== 'win32' && process.env.SLAX_APP_INHERIT_PROCESS_GROUP !== '1'
  const child = spawn(invocation.program, invocation.args, { cwd: root, stdio: 'inherit', detached: grouped })
  let interrupted
  const stop = signal => {
    interrupted = signal
    if (!child.pid) return
    try { grouped ? process.kill(-child.pid, signal) : child.kill(signal) }
    catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  const interrupt = () => stop('SIGINT')
  const terminate = () => stop('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('close', (code, signal) => {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
    process.exitCode = interrupted || signal ? 128 + (constants.signals[interrupted || signal] || 1) : code ?? 1
  })
}
