import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { compareVersions, ensureReleaseTag, reconcileAssets } from './cli-release.mjs'
import { pnpmInvocation } from './pnpm-command.mjs'

export const repository = 'slax-lab/slax-reader'
export const packageName = '@apps/slax-reader-extensions'
export const profiles = {
  dev: { profile: 'preview', extensionId: 'nkgkjnjkolpeiodphchpjiggkiciinik' },
  beta: { profile: 'beta', extensionId: 'bfkggphckdjelkonpoaepppkcecikclp' },
  main: { profile: 'production', extensionId: 'gdnhaajlomjkhahnmiijphnodkcfikfd' }
}
const root = fileURLToPath(new URL('../', import.meta.url))
const limit = 100 * 1024 * 1024
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const run = (program, args, options = {}) => execFileSync(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options })
const required = ['PUBLIC_BASE_URL', 'AUTH_BASE_URL', 'SHARE_BASE_URL', 'EXTENSIONS_API_BASE_URL', 'COOKIE_DOMAIN', 'COOKIE_TOKEN_NAME']
const optional = ['GOOGLE_ANALYTICS_MEASUREMENT_ID', 'UNINSTALL_FEEDBACK_URL']

function numericVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.split('.').some(n => BigInt(n) > 65535n) || version === '0.0.0') throw new Error('Expected a stable Chrome-compatible version')
}

export function releaseIdentity({ manifest, branch, sha, repo = repository }) {
  if (repo !== repository || !Object.hasOwn(profiles, branch) || !/^[a-f0-9]{40}$/.test(sha || '') || /^0+$/.test(sha)) throw new Error('Invalid extension release source')
  if (manifest.name !== packageName) throw new Error('Invalid extension package identity')
  numericVersion(manifest.version)
  const version = branch === 'main' ? manifest.version : `${manifest.version}-${branch}`
  return { repository, commit: sha, branch, ...profiles[branch], baseVersion: manifest.version, version, channel: branch === 'main' ? 'stable' : branch, tag: `ext-v${version}`, filename: `slax-reader-extension-${version}-chrome.zip` }
}

export function selectRelease({ manifest, previous, changed, branch, sha, repo }) {
  const release = releaseIdentity({ manifest, branch, sha, repo })
  if (previous.name !== packageName) throw new Error('Invalid previous extension identity')
  numericVersion(previous.version)
  const comparison = compareVersions(manifest.version, previous.version)
  if (comparison < 0) throw new Error('Extension version decreased')
  if (!changed || comparison === 0) return { eligible: false, reason: !changed ? 'No extension directory changes' : 'Extension version unchanged' }
  return { eligible: true, ...release }
}

export function preflight(env = process.env, cwd = root) {
  const branch = env.GITHUB_REF_NAME
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF_TYPE !== 'branch' || !Object.hasOwn(profiles, branch) || env.GITHUB_REF !== `refs/heads/${branch}`) throw new Error('Only release branch pushes can build')
  if (env.GITHUB_REPOSITORY !== repository) throw new Error('Invalid release repository')
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  if (event.ref !== env.GITHUB_REF || event.repository?.full_name !== repository || event.after !== env.GITHUB_SHA) throw new Error('Push event identity mismatch')
  if (event.created || event.deleted || event.forced) throw new Error('Created, deleted or forced pushes cannot release')
  for (const sha of [event.before, event.after]) if (!/^[a-f0-9]{40}$/.test(sha || '') || /^0+$/.test(sha)) throw new Error('Invalid comparison revision')
  const git = args => run('git', args, { cwd }).trim()
  if (git(['rev-parse', 'HEAD']) !== event.after) throw new Error('Checkout does not match event')
  for (const sha of [event.before, event.after]) {
    try { git(['cat-file', '-e', `${sha}^{commit}`]) } catch { throw new Error('Comparison revision unavailable') }
  }
  try { git(['merge-base', '--is-ancestor', event.before, event.after]) } catch { throw new Error('Push must preserve branch history') }
  try { git(['merge-base', '--is-ancestor', event.after, `origin/${branch}`]) } catch { throw new Error('Source is not reachable from release branch') }
  const manifest = JSON.parse(git(['show', `${event.after}:apps/extension/package.json`]))
  if (!isDeepStrictEqual(manifest, JSON.parse(readFileSync(join(cwd, 'apps/extension/package.json'), 'utf8')))) throw new Error('Working extension manifest differs from source')
  return selectRelease({ manifest, previous: JSON.parse(git(['show', `${event.before}:apps/extension/package.json`])), changed: !!git(['diff', '--name-only', event.before, event.after, '--', 'apps/extension']), branch, sha: event.after, repo: env.GITHUB_REPOSITORY })
}

export async function mergedPullRequest(release, request, { attempts = 3, sleep = delay } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      for (let page = 1; page <= 10; page++) {
        const pulls = await request(`/commits/${release.commit}/pulls?per_page=100&page=${page}`)
        if (!Array.isArray(pulls)) throw new Error('Invalid merged PR response')
        const match = pulls.find(pr => pr.merged_at && pr.merge_commit_sha === release.commit && pr.base?.ref === release.branch && pr.base.repo?.full_name === repository)
        if (match) return match.number
        if (pulls.length < 100) break
        if (page === 10) throw new Error('Merged PR pagination limit exceeded')
      }
    } catch (error) {
      if (attempt === attempts - 1) throw error
    }
    if (attempt < attempts - 1) await sleep(2000)
  }
  return null
}

export function validateBuildConfig(text, source = 'EXTENSION_BUILD_CONFIG') {
  let values
  try { values = JSON.parse(text) } catch { throw new Error(`Missing or invalid ${source} JSON`) }
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(k => ![...required, ...optional].includes(k)) || Object.values(values).some(v => typeof v !== 'string' || /[\r\n\0]/.test(v))) throw new Error(`Invalid public ${source} fields`)
  for (const key of required) if (!values[key]?.trim()) throw new Error(`${source} requires ${key}`)
  for (const key of ['PUBLIC_BASE_URL', 'AUTH_BASE_URL', 'SHARE_BASE_URL', 'EXTENSIONS_API_BASE_URL', 'UNINSTALL_FEEDBACK_URL']) {
    if (!values[key] && optional.includes(key)) continue
    let url
    try { url = new URL(values[key]) } catch { throw new Error(`Invalid ${source} ${key}`) }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`Invalid ${source} ${key}`)
  }
  if (!/^\.?[a-zA-Z0-9.-]+$/.test(values.COOKIE_DOMAIN) || values.COOKIE_TOKEN_NAME.length < 5 || /[\s;=]/.test(values.COOKIE_TOKEN_NAME)) throw new Error(`Invalid ${source} cookie settings`)
  return values
}

export async function resolveBuildConfig(env = process.env, cwd = root) {
  if (env.EXTENSION_BUILD_CONFIG?.trim()) return validateBuildConfig(env.EXTENSION_BUILD_CONFIG)
  let web
  try { web = JSON.parse(env.WEB_BUILD_CONFIG) } catch { throw new Error('Missing or invalid WEB_BUILD_CONFIG JSON; set it or EXTENSION_BUILD_CONFIG') }
  if (!web || typeof web !== 'object' || Array.isArray(web) || Object.values(web).some(value => typeof value !== 'string' || /[\r\n\0]/.test(value))) throw new Error('Invalid public WEB_BUILD_CONFIG fields')
  const { dwebEnvSchema } = await import(pathToFileURL(join(cwd, 'apps/web/env.schema.ts')).href)
  // Match the Web builder's treatment of empty optional public settings.
  for (const [key, value] of Object.entries(web)) if (value === '' && dwebEnvSchema.shape[key]?.isOptional()) delete web[key]
  if (!dwebEnvSchema.strict().safeParse(web).success) throw new Error('WEB_BUILD_CONFIG does not match the public Web schema')
  const values = Object.fromEntries(required.filter(key => key !== 'EXTENSIONS_API_BASE_URL').map(key => [key, web[key]]))
  values.EXTENSIONS_API_BASE_URL = web.DWEB_API_BASE_URL
  return validateBuildConfig(JSON.stringify(values), 'WEB_BUILD_CONFIG')
}

export function buildEnvironment(values, profile, env = process.env) {
  const clean = Object.fromEntries(['PATH', 'HOME', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP', 'npm_execpath', 'PNPM_HOME'].filter(k => env[k] !== undefined).map(k => [k, env[k]]))
  return { ...clean, ...values, SLAX_ENV: profile, CI: '1', GOOGLE_ANALYTICS_API_SECRET: '' }
}

export function inspectArchive(archive, release) {
  if (statSync(archive).size > limit) throw new Error('Extension archive exceeds size limit')
  let result
  try { result = JSON.parse(run('python3', [join(root, 'tooling/extension-release-archive.py'), archive])) } catch { throw new Error('Invalid extension archive') }
  const m = result.manifest
  // WXT omits a redundant stable version_name; Chrome displays version instead.
  if (m.manifest_version !== 3 || m.version !== release.baseVersion || (m.version_name ?? m.version) !== release.version || typeof m.key !== 'string') throw new Error('Extension manifest release identity mismatch')
  const hash = sha256(Buffer.from(m.key, 'base64')).slice(0, 32)
  const id = [...hash].map(c => 'abcdefghijklmnop'[parseInt(c, 16)]).join('')
  if (id !== release.extensionId) throw new Error('Extension profile ID mismatch')
  return result
}

export async function prepareRelease(directory, env = process.env, { release, cwd = root, execute = run } = {}) {
  release ??= candidate(env, cwd)
  const values = await resolveBuildConfig(env, cwd)
  const { extensionsEnvSchema } = await import(pathToFileURL(join(cwd, 'apps/extension/env.schema.ts')).href)
  if (!extensionsEnvSchema.safeParse(values).success) throw new Error('Public configuration does not satisfy the extension schema')
  for (const filename of ['.env.extension', `.env.extension.${release.profile}`]) if (existsSync(join(cwd, 'deploy/local', filename))) throw new Error('Release builds require no local extension environment files')
  const destination = resolve(directory)
  mkdirSync(destination, { recursive: true })
  if (readdirSync(destination).length) throw new Error('Release output directory must be empty')
  mkdirSync(join(cwd, 'apps/extension/build'), { recursive: true })
  const temporary = mkdtempSync(join(cwd, 'apps/extension/build/release-'))
  try {
    const config = join(temporary, 'wxt.release.mjs')
    writeFileSync(config, `import base from ${JSON.stringify(pathToFileURL(join(cwd, 'apps/extension/wxt.config.ts')).href)}\nexport default { ...base, outDir: ${JSON.stringify(join(temporary, 'output'))}, manifest: { ...base.manifest, version_name: ${JSON.stringify(release.version)} } }\n`)
    const command = pnpmInvocation(['extension', '--', 'zip', '-c', config])
    await execute(command.program, command.args, { cwd, env: buildEnvironment(values, release.profile, env), stdio: 'inherit' })
    const archives = readdirSync(join(temporary, 'output')).filter(name => name.endsWith('.zip'))
    if (archives.length !== 1) throw new Error('Expected exactly one extension ZIP')
    const source = join(temporary, 'output', archives[0])
    inspectArchive(source, release)
    copyFileSync(source, join(destination, release.filename))
    const metadata = { ...release, sha256: sha256(readFileSync(source)) }
    writeFileSync(join(destination, 'release.json'), JSON.stringify(metadata, null, 2) + '\n')
    writeFileSync(join(destination, 'SHA256SUMS'), `${metadata.sha256}  ${release.filename}\n`)
    return metadata
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

export function readRelease(directory, expected) {
  const release = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'))
  const identity = releaseIdentity({ manifest: { name: packageName, version: release.baseVersion }, branch: release.branch, sha: release.commit, repo: release.repository })
  if (!Object.entries(identity).every(([key, value]) => release[key] === value) || expected && !Object.entries(expected).every(([key, value]) => release[key] === value)) throw new Error('Release artifact source identity mismatch')
  if (release.filename !== basename(release.filename)) throw new Error('Invalid archive filename')
  const archive = join(directory, release.filename)
  inspectArchive(archive, release)
  if (sha256(readFileSync(archive)) !== release.sha256 || readFileSync(join(directory, 'SHA256SUMS'), 'utf8') !== `${release.sha256}  ${release.filename}\n`) throw new Error('Release artifact checksum mismatch')
  return release
}

export async function distributeRelease(release, directory, { request, readAsset, uploadAsset }) {
  readRelease(directory, release)
  await ensureReleaseTag(release, request)
  await ensureReleaseTag(release, request, { create: false })
  let remote = await request(`/releases/tags/${release.tag}`)
  if (!remote) remote = await request('/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: release.tag, target_commitish: release.commit, name: `Extension v${release.version}`, prerelease: release.channel !== 'stable', generate_release_notes: true, make_latest: 'false' }) })
  if (!remote) throw new Error('GitHub Release creation failed')
  await reconcileAssets({
    release, remote, assets: [release.filename, 'SHA256SUMS'].map(name => ({ name, bytes: readFileSync(join(directory, name)) })), readAsset,
    uploadAsset: async (target, asset) => { await ensureReleaseTag(release, request, { create: false }); await uploadAsset(target, asset) }
  })
}

function candidate(env, cwd = root) {
  const { eligible, reason, ...release } = preflight(env, cwd)
  if (!eligible) throw new Error(`No eligible extension release: ${reason}`)
  return release
}

async function githubRequest(path, options = {}) {
  if (!process.env.GH_TOKEN) throw new Error('GitHub workflow token is required')
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', ...options.headers }, signal: AbortSignal.timeout(30000) })
  if (response.status === 404 && (!options.method || options.method === 'GET') && !path.startsWith('/commits/')) return null
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`)
  return response.json()
}

async function main() {
  const [command, directory = '.local/extension-release'] = process.argv.slice(2)
  if (command === 'detect') {
    let selected = preflight()
    if (selected.eligible && !(await mergedPullRequest(selected, githubRequest))) selected = { eligible: false, reason: 'No matching merged pull request' }
    console.log(JSON.stringify(selected))
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `eligible=${selected.eligible}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, selected.eligible ? `Extension release: ${selected.tag} at ${selected.commit}\n` : `Extension release skipped: ${selected.reason}\n`)
  } else if (command === 'preflight') {
    console.log(JSON.stringify(preflight()))
  } else if (command === 'prepare') {
    console.log(JSON.stringify(await prepareRelease(directory)))
  } else if (command === 'verify' || command === 'publish') {
    const expected = candidate(process.env)
    const release = readRelease(resolve(directory), expected)
    if (command === 'verify') { console.log(JSON.stringify(release)); return }
    if (!(await mergedPullRequest(release, githubRequest))) throw new Error('No matching merged PR for publication')
    await distributeRelease(release, resolve(directory), {
      request: githubRequest,
      readAsset: async asset => {
        if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.size > limit) throw new Error('Invalid remote release asset')
        const response = await fetch(`https://api.github.com/repos/${repository}/releases/assets/${asset.id}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(30000) })
        if (!response.ok) throw new Error(`Asset download failed: ${response.status}`)
        const chunks = []; let length = 0
        for await (const chunk of response.body) { length += chunk.length; if (length > limit) throw new Error('Remote asset size limit exceeded'); chunks.push(chunk) }
        return Buffer.concat(chunks)
      },
      uploadAsset: async (target, asset) => {
        const response = await fetch(`https://uploads.github.com/repos/${repository}/releases/${target.id}/assets?name=${encodeURIComponent(asset.name)}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: asset.bytes, signal: AbortSignal.timeout(60000) })
        if (!response.ok) throw new Error(`Release asset upload failed: ${response.status}`)
      }
    })
  } else throw new Error('Usage: node tooling/extension-release.mjs <detect|preflight|prepare|verify|publish> [artifact-directory]')
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
