import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createJiti } from 'jiti'

const root = fileURLToPath(new URL('..', import.meta.url))
const jiti = createJiti(import.meta.url)
const bindings = await jiti.import('./backend-binding.ts')

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function command(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, stdio: 'inherit', shell: false, detached: false })
    const forward = signal => {
      if (child.pid) child.kill(signal)
    }
    const onInterrupt = () => forward('SIGINT')
    const onTerminate = () => forward('SIGTERM')
    const cleanup = () => {
      process.removeListener('SIGINT', onInterrupt)
      process.removeListener('SIGTERM', onTerminate)
    }
    process.once('SIGINT', onInterrupt)
    process.once('SIGTERM', onTerminate)
    child.once('error', error => {
      cleanup()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      cleanup()
      resolve(code ?? (signal ? 128 : 1))
    })
  })
}

const mode = process.argv[2]
if (mode === 'types') {
  const config = bindings.ensureWebWranglerConfig({ local: false }).generatedConfigPath
  process.exitCode = await command(pnpm, ['exec', 'wrangler', 'types', '-c', config])
} else if (mode === 'ssr-dev') {
  const buildCode = await command(pnpm, ['build'])
  if (buildCode !== 0) process.exitCode = buildCode
  else {
    fs.rmSync(path.join(root, '.wrangler', 'deploy', 'config.json'), { force: true })
    const selection = bindings.ensureWebWranglerConfig({ local: true })
    process.exitCode = await command(pnpm, [
      'exec', 'wrangler', 'pages', 'dev', '--config', selection.generatedConfigPath,
      '--port', '3000', '--inspector-port', '9333', '--persist-to', selection.stateDir
    ])
  }
} else {
  console.error('Usage: node config/wrangler-command.mjs <types|ssr-dev>')
  process.exitCode = 2
}
