import chalk from 'chalk'
import ora from 'ora'
import { apiErrorCode, apiErrorMessage } from './api.js'
import { failure, printJson, success } from './output.js'

export class CommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly hint?: string,
  ) {
    super(message)
  }
}

export interface JsonCommandOptions {
  json?: boolean
}

export interface CommandResult<T> {
  data: T
  message?: string
  render?: (data: T) => void
}

export interface WrappedCommandResult<T> extends CommandResult<T> {
  readonly __commandResult: true
}

export function commandResult<T>(result: CommandResult<T>): WrappedCommandResult<T> {
  return { ...result, __commandResult: true }
}

export interface RunCommandOptions<T> {
  loading?: string
  failMessage?: string
  emitJsonSuccess?: boolean
  action: () => Promise<WrappedCommandResult<T> | T> | WrappedCommandResult<T> | T
  onError?: (err: unknown) => void
}

export async function runCommand<T>(opts: JsonCommandOptions, config: RunCommandOptions<T>): Promise<void> {
  const spinner = opts.json || !config.loading ? null : ora(config.loading).start()

  try {
    const result = normalizeResult(await config.action())
    spinner?.stop()

    if (opts.json && config.emitJsonSuccess !== false) {
      printJson(success(result.data))
      return
    }

    if (opts.json) return

    if (result.render) {
      result.render(result.data)
    } else if (result.message) {
      console.log(result.message)
    }
  } catch (err) {
    config.onError?.(err)
    spinner?.fail(config.failMessage ?? 'Command failed')

    if (opts.json) {
      printJson(failure(commandErrorCode(err), commandErrorMessage(err), commandErrorHint(err)))
      process.exit(1)
    }

    handleCommandError(err)
  }
}

export function printJsonFailure(opts: JsonCommandOptions, code: string, message: string, hint?: string): never {
  if (opts.json) {
    printJson(failure(code, message, hint))
  } else {
    console.error(chalk.red(message))
    if (hint) console.error(chalk.dim(hint))
  }
  process.exit(1)
}

function commandErrorCode(err: unknown): string {
  return err instanceof CommandError ? err.code : apiErrorCode(err)
}

function commandErrorMessage(err: unknown): string {
  return err instanceof CommandError ? err.message : apiErrorMessage(err)
}

function commandErrorHint(err: unknown): string | undefined {
  return err instanceof CommandError ? err.hint : undefined
}

function handleCommandError(err: unknown): never {
  console.error(chalk.red(commandErrorMessage(err)))
  const hint = commandErrorHint(err)
  if (hint) console.error(chalk.dim(hint))
  process.exit(1)
}

function normalizeResult<T>(result: CommandResult<T> | T): CommandResult<T> {
  if (isCommandResult(result)) return result
  return { data: result }
}

function isCommandResult<T>(result: CommandResult<T> | T): result is CommandResult<T> {
  return typeof result === 'object' && result !== null && '__commandResult' in result
}
