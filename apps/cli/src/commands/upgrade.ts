import { execSync } from 'node:child_process'
import { Command } from 'commander'
import chalk from 'chalk'
import { checkForUpdate, getLatestVersion } from '../lib/version.js'
import { CommandError, commandResult, runCommand } from '../lib/command.js'
import { buildInstallCommand } from '../lib/packageManager.js'
import { syncSkillToVersion, type SkillSyncResult } from '../lib/skillSync.js'

interface UpgradeOptions {
  check?: boolean
  json?: boolean
}

export function registerUpgradeCommands(program: Command): void {
  program
    .command('upgrade')
    .description('Upgrade CLI to the latest version')
    .option('--check', 'Only check for updates, do not install')
    .option('--json', 'Output JSON')
    .action(async (opts: UpgradeOptions) => {
      const currentVersion = program.version() ?? '0.0.0'
      const latestVersion = await fetchLatestVersion(opts)
      const updateAvailable = await checkForUpdate(currentVersion)

      if (!updateAvailable) {
        if (!opts.json) console.log(chalk.green(`Already up to date (v${currentVersion})`))
        if (opts.check) {
          await emitUpgradeResult(opts, {
            current: currentVersion,
            latest: latestVersion,
            updateAvailable: false,
          }, `Already up to date (v${currentVersion})`)
          return
        }

        const skillsResult = await syncSkill(currentVersion, opts)
        await emitUpgradeResult(opts, {
          current: currentVersion,
          latest: latestVersion,
          updateAvailable: false,
          skillsAction: skillsResult.action,
          ...(skillsResult.action === 'failed' ? { skillsWarning: skillsResult.error, skillsHint: skillsResult.hint } : {}),
        })
        return
      }

      if (opts.check) {
        if (!opts.json) console.log(chalk.dim('Run `reader-cli upgrade` to install.'))
        await emitUpgradeResult(opts, {
          current: currentVersion,
          latest: latestVersion,
          updateAvailable: true,
          command: 'reader-cli upgrade',
        }, `New version available: v${currentVersion} → v${latestVersion}`)
        return
      }

      if (!opts.json) console.log(`New version available: ${chalk.yellow(`v${currentVersion}`)} → ${chalk.green(`v${latestVersion}`)}`)
      const installCmd = buildInstallCommand()
      await runCommand(opts, {
        loading: 'Upgrading...',
        failMessage: 'Upgrade failed',
        emitJsonSuccess: false,
        action: () => {
          try {
            execSync(installCmd, { stdio: 'pipe' })
            return commandResult({
              data: { upgraded: true },
              message: chalk.green(`Successfully upgraded to v${latestVersion}`),
            })
          } catch {
            throw new CommandError('upgrade_failed', 'Upgrade failed.', `Try manually: ${installCmd}`)
          }
        },
      })

      const skillsResult = await syncSkill(latestVersion, opts)
      await emitUpgradeResult(opts, {
        current: currentVersion,
        latest: latestVersion,
        upgraded: true,
        skillsAction: skillsResult.action,
        ...(skillsResult.action === 'failed' ? { skillsWarning: skillsResult.error, skillsHint: skillsResult.hint } : {}),
      })
    })
}

async function fetchLatestVersion(opts: UpgradeOptions): Promise<string> {
  let latestVersion = ''
  await runCommand(opts, {
    loading: 'Checking for updates...',
    failMessage: 'Failed to check for updates. Please check your network.',
    emitJsonSuccess: false,
    action: async () => {
      latestVersion = await getLatestVersion() ?? ''
      if (!latestVersion) {
        throw new CommandError('update_check_failed', 'Failed to check for updates. Please check your network.')
      }
      return commandResult({ data: { latest: latestVersion } })
    },
  })
  return latestVersion
}

async function syncSkill(currentVersion: string, opts: UpgradeOptions): Promise<SkillSyncResult> {
  let result: SkillSyncResult | undefined
  await runCommand(opts, {
    loading: 'Syncing Slax Reader AI Agent skill...',
    failMessage: 'Skill sync failed',
    emitJsonSuccess: false,
    action: async () => {
      result = await syncSkillToVersion(currentVersion)
      return commandResult({
        data: result,
        render: () => {
          if (result?.action === 'in_sync') {
            console.log(chalk.green(`Skill is already in sync (v${currentVersion}).`))
          } else if (result?.action === 'synced') {
            console.log(chalk.green(`Skill synced for reader-cli v${currentVersion}.`))
          } else {
            console.warn(chalk.yellow('Skill sync failed'))
            if (result?.error) console.error(chalk.red(result.error))
            if (result?.hint) console.error(chalk.dim(result.hint))
          }
        },
      })
    },
  })
  return result!
}

async function emitUpgradeResult(opts: UpgradeOptions, data: Record<string, unknown>, message?: string): Promise<void> {
  await runCommand(opts, {
    action: () => commandResult({
      data,
      message: message ? chalk.green(message) : undefined,
    }),
  })
}
