const CI_ENV_KEYS = ['CI', 'BUILD_NUMBER', 'RUN_ID'] as const
const GIT_DESCRIBE_PATTERN = /-\d+-g[0-9a-f]{7,}/
const RELEASE_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function isCI(): boolean {
  return CI_ENV_KEYS.some((key) => Boolean(process.env[key]))
}

export function isReleaseVersion(version: string): boolean {
  if (!version || version === 'DEV' || version === 'dev') return false
  if (GIT_DESCRIBE_PATTERN.test(version)) return false
  return RELEASE_PATTERN.test(version)
}
