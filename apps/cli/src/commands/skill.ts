import { Command } from 'commander'
import chalk from 'chalk'
import { CommandError, commandResult, runCommand } from '../lib/command.js'
import { readSkillStamp } from '../lib/skillscheck.js'
import { syncSkillToVersion } from '../lib/skillSync.js'

interface SkillOptions {
  check?: boolean
  sync?: boolean
  force?: boolean
  json?: boolean
}

export function registerSkillCommands(program: Command, currentVersion: string): void {
  program
    .command('skill')
    .description('Check or sync Slax Reader AI Agent skill')
    .option('--check', 'Check skill sync status')
    .option('--sync', 'Install or update the AI Agent skill')
    .option('--force', 'Force sync even when stamp is already current')
    .option('--json', 'Output JSON')
    .action(async (opts: SkillOptions) => {
      if (opts.sync) {
        await syncSkill(currentVersion, opts)
        return
      }
      await checkSkill(currentVersion, opts)
    })
}

async function checkSkill(currentVersion: string, opts: SkillOptions): Promise<void> {
  const stamp = (await readSkillStamp()) ?? ''
  const data = {
    stamp,
    current: currentVersion,
    inSync: stamp === currentVersion,
  }

  await runCommand(opts, {
    action: () => commandResult({
      data,
      render: () => {
        if (data.inSync) {
          console.log(chalk.green(`Skill is in sync (v${currentVersion}).`))
        } else if (stamp) {
          console.log(chalk.yellow(`Skill is out of sync: v${stamp} → v${currentVersion}`))
          console.log(chalk.dim('Run `reader-cli skill --sync` to update.'))
        } else {
          console.log(chalk.yellow('Skill is not installed.'))
          console.log(chalk.dim('Run `reader-cli skill --sync` to install.'))
        }
      },
    }),
  })
}

async function syncSkill(currentVersion: string, opts: SkillOptions): Promise<void> {
  await runCommand(opts, {
    loading: 'Installing Slax Reader AI Agent skill...',
    failMessage: 'Skill sync failed',
    action: async () => {
      const result = await syncSkillToVersion(currentVersion, { force: opts.force })

      if (result.action === 'failed') {
        throw new CommandError('skill_sync_failed', result.error ?? 'Skill sync failed.', result.hint)
      }

      const data = { action: result.action, current: currentVersion }
      return commandResult({
        data,
        render: () => {
          if (result.action === 'in_sync') {
            console.log(chalk.green(`Skill is already in sync (v${currentVersion}).`))
          } else {
            console.log(chalk.green(`Skill synced for reader-cli v${currentVersion}.`))
          }
        },
      })
    },
  })
}
