import { isIP } from 'node:net'

export const branches = Object.freeze({ dev: 'dev', beta: 'beta', main: 'prod' })
export const shaPattern = /^[a-f0-9]{40}$/
export class ReleaseError extends Error {
  constructor(category, exitCode = 1, field) {
    super(category)
    this.category = category
    this.field = field
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0 && exitCode < 256 ? exitCode : 1
  }
}
export function requireValue(condition, category = 'invalid-configuration', field) {
  if (!condition) throw new ReleaseError(category, 1, field)
}
export function eligibility(event, { eventName, repository, environment, codeRef }) {
  const pr = event?.pull_request
  const branch = pr?.base?.ref
  requireValue(eventName === 'pull_request_target' && event?.action === 'closed' && pr?.merged === true, 'ineligible-event')
  requireValue(typeof repository === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repository) && pr?.base?.repo?.full_name === repository && event?.repository?.full_name === repository, 'ineligible-event')
  requireValue(Object.hasOwn(branches, branch ?? '') && branches[branch] === environment, 'ineligible-event')
  requireValue(shaPattern.test(pr?.merge_commit_sha ?? '') && codeRef === pr.merge_commit_sha && Number.isSafeInteger(pr.number) && pr.number > 0, 'ineligible-event')
  return { branch, environment, codeRef, number: pr.number }
}
export function relativeFile(value, suffix) {
  requireValue(typeof value === 'string' && value.length < 512 && /^[A-Za-z0-9_./-]+$/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..') && value.endsWith(suffix))
  requireValue(!value.split('/').some(part => /^\.(?:env|dev\.vars)(?:\.|$)/.test(part) || /credential|private[-_]key/i.test(part)))
  return value
}
export function selectors(secrets) {
  requireValue(/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(secrets.API_CONFIG_REPOSITORY ?? ''), 'invalid-selectors', 'API_CONFIG_REPOSITORY')
  requireValue(shaPattern.test(secrets.API_CONFIG_REF ?? ''), 'invalid-selectors', 'API_CONFIG_REF')
  try { relativeFile(secrets.API_CONFIG_MANIFEST_PATH, '.json') } catch { throw new ReleaseError('invalid-selectors', 1, 'API_CONFIG_MANIFEST_PATH') }
  requireValue(Boolean(secrets.CONFIG_REPO_TOKEN), 'missing-secrets', 'CONFIG_REPO_TOKEN')
}
const identifier = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
const worker = value => typeof value === 'string' && /^[a-z0-9_][a-z0-9_-]*$/.test(value)
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
function keys(value, allowed) {
  requireValue(plain(value) && Object.keys(value).every(key => allowed.includes(key)))
}
function validateManifestEntry(selected) {
  keys(selected, ['config', 'wranglerEnvironment', 'accountId', 'firewallZoneId', 'tunnel', 'workers'])
  relativeFile(selected.config, '.toml')
  requireValue(selected.wranglerEnvironment === undefined || (typeof selected.wranglerEnvironment === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(selected.wranglerEnvironment)))
  requireValue(identifier(selected.accountId) && identifier(selected.firewallZoneId))
  keys(selected.tunnel, ['hostname', 'port'])
  requireValue(typeof selected.tunnel.hostname === 'string' && selected.tunnel.hostname.length <= 253 && selected.tunnel.hostname.includes('.') && selected.tunnel.hostname.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)) && !isIP(selected.tunnel.hostname))
  requireValue(Number.isInteger(selected.tunnel.port) && selected.tunnel.port > 1024 && selected.tunnel.port <= 65535)
  keys(selected.workers, ['core', 'edge', 'ai', 'browser'])
  requireValue(['core', 'edge', 'ai', 'browser'].every(key => worker(selected.workers[key])) && new Set(Object.values(selected.workers)).size === 4)
}
export function manifestSettings(manifest, environment) {
  keys(manifest, ['version', 'environments'])
  requireValue(manifest.version === 1)
  keys(manifest.environments, Object.values(branches))
  Object.values(manifest.environments).forEach(validateManifestEntry)
  const selected = manifest.environments[environment]
  requireValue(Boolean(selected))
  // When both production manifests are present, enforce their shared installation.
  if (environment !== 'dev') {
    const other = manifest.environments[environment === 'beta' ? 'prod' : 'beta']
    requireValue(other && selected.accountId === other.accountId && selected.firewallZoneId === other.firewallZoneId && selected.workers.browser === other.workers?.browser && selected.tunnel.hostname === other.tunnel?.hostname && selected.tunnel.port === other.tunnel?.port)
  }
  return selected
}
// Wrangler may execute build hooks or discover extra files. Release configuration
// is data only; entrypoints, TypeScript and D1 paths are supplied by API tooling.
const forbiddenKeys = /secret|password|private.?key|api.?key|auth.?key|access.?key|authorization|token|credential|command|hook/i
const forbiddenTables = new Set(['build', 'assets', 'site', 'define', 'unsafe', 'containers', 'cloudchamber'])
export function declarativeConfiguration(value) {
  requireValue(plain(value))
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit)
    if (plain(node)) {
      for (const [key, child] of Object.entries(node)) {
        requireValue(!forbiddenKeys.test(key) && !forbiddenTables.has(key) && key !== 'localConnectionString' && !['IMAGER_CHECK_DIGST_SALT', 'HASH_IDS_SALT', 'REPORT_PUSH_API', 'STRIPE_PUSH_API', 'ERROR_LOG_PUSH_API', 'CRAWL_PUSH_API'].includes(key))
        visit(child)
      }
    } else if (typeof node === 'string') {
      requireValue(!/-----BEGIN [\w ]*PRIVATE KEY-----|(?:postgres(?:ql)?|https?):\/\/[^\s/]*@|(?:postgres(?:ql)?):\/\/|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_-]+|[?&](?:key|token|secret|password|access_token|api_key|client_secret)=/i.test(node))
      if (/^\s*[{[]/.test(node)) {
        let embedded
        try { embedded = JSON.parse(node) } catch { return }
        visit(embedded)
      }
    }
  }
  visit(value)
}
export function databaseURLs(secrets, settings) {
  return ['HYPERDRIVE_DATABASE_URL', 'LOGS_DATABASE_URL'].map(key => {
    requireValue(Boolean(secrets[key]), 'missing-secrets', key)
    let url
    try { url = new URL(secrets[key]) } catch { throw new ReleaseError('invalid-database-url') }
    requireValue(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1' && Number(url.port) === settings.tunnel.port && Boolean(url.username) && Boolean(url.password) && url.pathname.length > 1 && !url.hash && !url.searchParams.has('host') && !url.searchParams.has('port'), 'invalid-database-url')
    return secrets[key]
  })
}
export function publicIP(value) {
  requireValue(typeof value === 'string' && isIP(value) === 4, 'invalid-public-ip')
  const [a, b, c] = value.split('.').map(Number)
  requireValue(a > 0 && a < 224 && ![10, 127].includes(a) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)))) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113), 'invalid-public-ip')
  return value
}
