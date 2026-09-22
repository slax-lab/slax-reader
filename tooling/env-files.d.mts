export const DEPLOY_DIRECTORIES: Readonly<Record<'web' | 'extension', string>>
export const ENV_NAMES: ReadonlySet<string>
export function applyDeployEnvironment(options: {
  appName: 'web' | 'extension'
  root: string
  envName?: string
  processEnvironment?: NodeJS.ProcessEnv
}): {
  values: Record<string, string>
  environment: Record<string, string>
  sources: Record<string, string>
  files: string[]
  envName: string
  directory: string
}
export function loadDeployEnvironment(options: {
  appName: 'web' | 'extension'
  root: string
  envName?: string
  processEnvironment?: NodeJS.ProcessEnv
}): ReturnType<typeof applyDeployEnvironment>
