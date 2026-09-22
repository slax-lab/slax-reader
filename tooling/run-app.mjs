import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function forwardedArguments(argumentsList) {
  return argumentsList[0] === '--' ? argumentsList.slice(1) : argumentsList
}

function packageCommands(packagePath) {
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  const scripts = manifest.scripts || {}
  const lifecycleCommands = new Set(['install', 'prepare', 'preinstall', 'postinstall', 'prepublish', 'postpublish'])
  return Object.keys(scripts)
    .filter(command => {
      if (lifecycleCommands.has(command)) return false
      if (command.startsWith('pre') && Object.hasOwn(scripts, command.slice(3))) return false
      if (command.startsWith('post') && Object.hasOwn(scripts, command.slice(4))) return false
      return true
    })
    .sort()
}

function printUsage({ commandName, appLabel, commands, aliases }) {
  const aliasLines = Object.entries(aliases)
    .map(([alias, command]) => `  ${alias} → ${command}`)
    .join('\n')
  const aliasesText = aliasLines ? `\n\n别名：\n${aliasLines}` : ''
  console.log(`用法：pnpm ${commandName} -- <命令> [参数]\n\n${appLabel} 可用命令：\n  ${commands.join('\n  ')}${aliasesText}`)
}

function resolveCommand(requestedCommand, aliases) {
  return aliases[requestedCommand] || requestedCommand
}

function runApp({ commandName, appLabel, packageName, packagePath, commands, aliases = {}, argumentsList = process.argv.slice(2) }) {
  const args = forwardedArguments(argumentsList)
  const requestedCommand = args[0]

  let availableCommands = commands
  if (!availableCommands) {
    try {
      availableCommands = packageCommands(resolve(REPO_ROOT, packagePath))
    } catch (error) {
      console.error(`${appLabel} 命令清单读取失败：${error.message}`)
      process.exitCode = 1
      return process.exitCode
    }
  }

  if (!requestedCommand || requestedCommand === 'help' || requestedCommand === '--help' || requestedCommand === '-h') {
    printUsage({ commandName, appLabel, commands: availableCommands, aliases })
    process.exitCode = requestedCommand ? 0 : 2
    return process.exitCode
  }

  const command = resolveCommand(requestedCommand, aliases)
  if (!availableCommands.includes(command)) {
    console.error(`未知的 ${appLabel} 命令：${requestedCommand}`)
    printUsage({ commandName, appLabel, commands: availableCommands, aliases })
    process.exitCode = 2
    return process.exitCode
  }

  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const child = spawn(pnpmCommand, ['--filter', packageName, 'run', command, '--', ...args.slice(1)], {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  })

  child.on('error', error => {
    console.error(`${appLabel} 命令启动失败：${error.message}`)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0)
  })
  return undefined
}

export { forwardedArguments, packageCommands, printUsage, resolveCommand, runApp }
