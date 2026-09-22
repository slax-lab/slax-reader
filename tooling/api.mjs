import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { constants } from 'node:os'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('../apps/api/package.json', import.meta.url), 'utf8'))
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()
const [command, ...forwarded] = args
if (!command || command === '--help' || command === '-h') {
  console.log(`Usage: pnpm api -- <command> [arguments]\n\n${Object.keys(manifest.scripts).join('\n')}`)
  process.exit(command ? 0 : 1)
}
if (!Object.hasOwn(manifest.scripts, command)) {
  console.error(`Unknown API command: ${command}. Run pnpm api -- --help.`)
  process.exit(1)
}
// Arguments are passed as data; shell syntax in a user argument is never evaluated here.
// A parent smoke harness may already own the entire process group.
const grouped = process.platform !== 'win32' && process.env.SLAX_API_INHERIT_PROCESS_GROUP !== '1'
const child = spawn('pnpm', ['--filter', manifest.name, 'run', command, ...forwarded], {
  cwd: root, stdio: 'inherit', detached: grouped
})
let interrupted
const stop = signal => {
  interrupted = signal
  try { grouped ? process.kill(-child.pid, signal) : child.kill(signal) } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}
const interrupt = () => stop('SIGINT')
const terminate = () => stop('SIGTERM')
process.on('SIGINT', interrupt)
process.on('SIGTERM', terminate)
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('close', (code, signal) => {
  process.removeListener('SIGINT', interrupt)
  process.removeListener('SIGTERM', terminate)
  const reason = interrupted || signal
  process.exitCode = reason ? 128 + (constants.signals[reason] || 1) : code ?? 1
})
