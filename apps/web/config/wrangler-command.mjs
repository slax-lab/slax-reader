import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { createJiti } from 'jiti'
import { applyDeployEnvironment } from '../../../tooling/env-files.mjs'
import { pnpmInvocation } from '../../../tooling/pnpm-command.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
applyDeployEnvironment({ appName: 'web', root: path.resolve(root, '../..') })
const jiti = createJiti(import.meta.url)
const bindings = await jiti.import('./backend-binding.ts')

function command(args) {
  return new Promise((resolve, reject) => {
    const invocation = pnpmInvocation(args)
    const child = spawn(invocation.program, invocation.args, { cwd: root, stdio: 'inherit', shell: false, detached: false })
    let interrupted
    const forward = signal => {
      interrupted = signal
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
    child.once('close', (code, signal) => {
      cleanup()
      const reason = interrupted || signal
      resolve(reason ? 128 + (constants.signals[reason] || 1) : code ?? 1)
    })
  })
}

const mode = process.argv[2]
if (mode === 'types') {
  const config = bindings.ensureWebWranglerConfig({ local: false }).generatedConfigPath
  process.exitCode = await command(['exec', 'wrangler', 'types', '-c', config])
} else if (mode === 'ssr-dev') {
  const buildCode = await command(['build'])
  if (buildCode !== 0) process.exitCode = buildCode
  else {
    fs.rmSync(path.join(root, '.wrangler', 'deploy', 'config.json'), { force: true })
    const selection = bindings.ensureWebWranglerConfig({ local: true })
    bindings.warnIfApiConfigMissing(selection, true)
    // Pages dev has no --config flag; --cwd makes it auto-discover the generated wrangler.toml instead.
    process.exitCode = await command([
      'exec', 'wrangler', 'pages', 'dev', '--cwd', path.dirname(selection.generatedConfigPath),
      '--port', '3000', '--inspector-port', '9333', '--persist-to', selection.stateDir
    ])
  }
} else {
  console.error('Usage: node config/wrangler-command.mjs <types|ssr-dev>')
  process.exitCode = 2
}
