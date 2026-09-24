#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pnpmInvocation } from './pnpm-command.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SETUP_STEPS = [
  ['API', ['api', '--', 'setup']],
  ['Web', ['web', '--', 'setup']],
  ['Extension', ['extension', '--', 'setup']]
]

function printHelp() {
  console.log(`用法：pnpm setup:all\n\n按 API → Web → Extension 顺序执行各模块 setup。\nsetup:all 只负责初始化，不会启动 dev server。`)
}

function runStep(label, args, { root = REPO_ROOT, spawnProcess = spawn, environment = process.env } = {}) {
  return new Promise(resolvePromise => {
    const grouped = process.platform !== 'win32' && environment.SLAX_SETUP_ALL_INHERIT_PROCESS_GROUP !== '1'
    let child
    try {
      const invocation = pnpmInvocation(args, { env: environment })
      child = spawnProcess(invocation.program, invocation.args, {
        cwd: root,
        stdio: 'inherit',
        detached: grouped,
        env: {
          ...environment,
          SLAX_API_INHERIT_PROCESS_GROUP: '1',
          SLAX_APP_INHERIT_PROCESS_GROUP: '1'
        }
      })
    } catch {
      console.error(`${label} setup 无法启动，请检查 pnpm 安装和 workspace 命令。`)
      resolvePromise(1)
      return
    }

    let interrupted
    const stop = signal => {
      interrupted = signal
      if (!child.pid) return
      try {
        grouped ? process.kill(-child.pid, signal) : child.kill(signal)
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error
      }
    }
    const interrupt = () => stop('SIGINT')
    const terminate = () => stop('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    child.once('error', error => {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
      console.error(`${label} setup 启动失败：${error.message}`)
      resolvePromise(1)
    })
    child.once('close', (code, signal) => {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
      const reason = interrupted || signal
      resolvePromise(reason ? 128 + (constants.signals[reason] || 1) : code ?? 1)
    })
  })
}

async function runSetupAll({ root = REPO_ROOT, steps = SETUP_STEPS, spawnProcess = spawn, environment = process.env } = {}) {
  console.log('Slax Reader setup:all：按 API → Web → Extension 初始化本地项目')
  for (const [label, args] of steps) {
    console.log(`\n==> ${label} setup`)
    const status = await runStep(label, args, {
      root,
      spawnProcess,
      environment
    })
    if (status !== 0) {
      console.error(`${label} setup 失败（exit ${status}），已停止后续初始化。`)
      return status
    }
  }
  console.log('\nsetup:all 完成。请分别运行 pnpm api -- dev、pnpm web -- dev 和 pnpm extension -- dev。')
  return 0
}

export { REPO_ROOT, SETUP_STEPS, runSetupAll, runStep }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(argument => argument !== '--')
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    printHelp()
    process.exitCode = 0
  } else if (args.length) {
    console.error('setup:all 不接受参数。单模块参数请通过 pnpm <app> -- setup 传入；运行 pnpm setup:all --help 查看用法。')
    process.exitCode = 2
  } else {
    runSetupAll().then(code => {
      process.exitCode = code
    })
  }
}
