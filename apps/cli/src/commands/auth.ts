import { Command } from 'commander'
import chalk from 'chalk'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { getApiKey, setApiKey, clearApiKey, getApiBase, setApiBase, getConfigPath } from '../lib/config.js'
import { request } from '../lib/api.js'
import { commandResult, printJsonFailure, runCommand } from '../lib/command.js'
import type { UserInfo } from '../types.js'

interface AuthOptions {
  apiKey?: string
  apiBase?: string
  json?: boolean
}

interface JsonOptions {
  json?: boolean
}

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Log in with your API Key')
    .option('--api-key <key>', 'API Key (starts with sr-)')
    .option('--api-base <url>', 'Custom API base URL')
    .option('--json', 'Output JSON')
    .action(async (opts: AuthOptions) => {
      let apiKey: string = opts.apiKey ?? ''

      if (!apiKey) {
        if (opts.json) {
          printJsonFailure(opts, 'missing_api_key', 'API Key is required in JSON mode.', 'Pass --api-key <key>.')
        }
        const rl = createInterface({ input: stdin, output: stdout })
        try {
          apiKey = await rl.question(chalk.cyan('Enter your API Key (starts with sr-): '))
        } finally {
          rl.close()
        }
      }

      apiKey = apiKey.trim()
      if (!apiKey) {
        printJsonFailure(opts, 'empty_api_key', 'API Key cannot be empty.')
      }

      if (!apiKey.startsWith('sr-')) {
        printJsonFailure(opts, 'invalid_api_key', 'Invalid API Key format. It should start with "sr-".')
      }

      if (opts.apiBase) {
        setApiBase(opts.apiBase)
      }

      setApiKey(apiKey)

      await runCommand(opts, {
        loading: 'Verifying API Key...',
        failMessage: 'Login failed',
        onError: clearApiKey,
        action: async () => {
          const user = await request<UserInfo>('GET', '/v1/user/me')
          return commandResult({
            data: { user, apiBase: getApiBase(), configPath: getConfigPath() },
            render: ({ user }) => {
              console.log(chalk.green(`Logged in as ${chalk.bold(user.username || user.email || 'User')}`))
              console.log(chalk.dim(`Config saved to ${getConfigPath()}`))
            },
          })
        },
      })
    })

  program
    .command('logout')
    .description('Log out and clear stored API Key')
    .option('--json', 'Output JSON')
    .action(async (opts: JsonOptions) => {
      clearApiKey()
      await runCommand(opts, {
        action: () => commandResult({
          data: { loggedOut: true },
          message: chalk.green('Logged out successfully.'),
        }),
      })
    })

  program
    .command('whoami')
    .description('Show current user information')
    .option('--json', 'Output JSON')
    .action(async (opts: JsonOptions) => {
      const key = getApiKey()
      if (!key) {
        printJsonFailure(opts, 'not_logged_in', 'Not logged in. Run `reader-cli login` first.')
      }

      await runCommand(opts, {
        loading: 'Fetching user info...',
        failMessage: 'Failed to fetch user info',
        action: async () => {
          const user = await request<UserInfo>('GET', '/v1/user/me')
          return commandResult({
            data: {
              user,
              apiBase: getApiBase(),
              apiKeyPrefix: `${key.slice(0, 9)}...`,
            },
            render: () => {
              console.log(chalk.bold('Current User:'))
              console.log(`  Username : ${chalk.cyan(user.username || '-')}`)
              console.log(`  Email    : ${chalk.cyan(user.email || '-')}`)
              console.log(`  API Base : ${chalk.dim(getApiBase())}`)
              console.log(`  API Key  : ${chalk.dim(key.slice(0, 9) + '...')}`)
            },
          })
        },
      })
    })
}
