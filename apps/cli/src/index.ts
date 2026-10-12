import { Command } from 'commander'
import { registerAuthCommands } from './commands/auth.js'
import { registerBookmarkCommands } from './commands/bookmark.js'
import { registerUpgradeCommands } from './commands/upgrade.js'
import { registerSkillCommands } from './commands/skill.js'
import { registerInstallCommand } from './commands/install.js'
import { initSkillCheck } from './lib/skillscheck.js'
import { initUpgradeCheck } from './lib/version.js'
import { track } from './lib/track.js'

declare const __VERSION__: string

const program = new Command()

program
  .name('reader-cli')
  .description('Slax Reader API client CLI - manage bookmarks from the command line')
  .version(__VERSION__, '-v, --version')

await initUpgradeCheck(__VERSION__)
await initSkillCheck(__VERSION__)

program.hook('preAction', () => {
  track(__VERSION__)
})

registerAuthCommands(program)
registerBookmarkCommands(program)
registerUpgradeCommands(program)
registerSkillCommands(program, __VERSION__)
registerInstallCommand(program, __VERSION__)

program.parse()
