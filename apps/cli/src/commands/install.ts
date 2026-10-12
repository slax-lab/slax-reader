import { execSync } from 'node:child_process'
import { Command } from 'commander'
import chalk from 'chalk'
import { CommandError, commandResult, runCommand } from '../lib/command.js'
import { writeSkillStamp, clearPendingSkill } from '../lib/skillscheck.js'
import { execNpx } from '../lib/exec.js'
import { buildInstallCommand } from '../lib/packageManager.js'
import { SKILL_INSTALL_ARGS } from '../lib/skillSource.js'

interface InstallOptions {
  json?: boolean
}

export function registerInstallCommand(program: Command, currentVersion: string): void {
  program
    .command('install')
    .description('Install reader-cli globally and set up the AI Agent skill')
    .option('--json', 'Output JSON')
    .action(async (opts: InstallOptions) => {
      await runInstall(currentVersion, opts)
    })
}

async function runInstall(currentVersion: string, opts: InstallOptions): Promise<void> {
  const installCmd = buildInstallCommand()

  await runCommand(opts, {
    loading: 'Installing @slax-lab/reader-cli...',
    failMessage: 'CLI install failed.',
    emitJsonSuccess: false,
    action: () => {
      try {
        execSync(installCmd, { stdio: 'pipe' })
        return commandResult({
          data: { installed: true },
          message: chalk.green('@slax-lab/reader-cli installed globally.'),
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        throw new CommandError('cli_install_failed', msg, `Try manually: ${installCmd}`)
      }
    },
  })

  let skillInstalled = false
  await runCommand(opts, {
    loading: 'Installing AI Agent skill...',
    failMessage: 'Skill install failed (skills tool may not be available).',
    emitJsonSuccess: false,
    action: async () => {
      try {
        await execNpx(SKILL_INSTALL_ARGS, {
          timeout: 10 * 60 * 1000,
          maxBuffer: 10 * 1024 * 1024,
        })
        const installedVersion = resolveInstalledVersion(currentVersion)
        await writeSkillStamp(installedVersion)
        clearPendingSkill()
        skillInstalled = true
        return commandResult({
          data: { skillInstalled: true },
          message: chalk.green('AI Agent skill installed.'),
        })
      } catch {
        return commandResult({
          data: { skillInstalled: false },
          message: chalk.dim('To install later, run: reader-cli skill --sync'),
        })
      }
    },
  })

  await runCommand(opts, {
    action: () => {
      const version = resolveInstalledVersion(currentVersion)
      const data = skillInstalled
        ? { installed: true, skillInstalled: true, version }
        : {
            installed: true,
            skillInstalled: false,
            version,
            hint: 'AI Agent skill install failed. Run: reader-cli skill --sync',
          }
      return commandResult({
        data,
        render: () => {
          console.log()
          console.log(chalk.green('Setup complete.'))
          console.log(chalk.dim('Run `reader-cli login` to authenticate.'))
        },
      })
    },
  })
}

function resolveInstalledVersion(fallback: string): string {
  try {
    const out = execSync('reader-cli --version', { stdio: 'pipe' }).toString().trim()
    return out || fallback
  } catch {
    return fallback
  }
}
