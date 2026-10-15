import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { pnpmInvocation } from './pnpm-command.mjs'

export const repository = 'slax-lab/slax-reader'
export const packageName = '@slax-lab/reader-cli'
const root = fileURLToPath(new URL('../', import.meta.url))
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const digest = (bytes, algorithm, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)
const run = (program, args, options = {}) => execFileSync(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })

export function compareVersions(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.trim() !== a || b.trim() !== b || !stableVersion.test(a) || !stableVersion.test(b)) throw new Error('Expected stable semantic versions')
  const left = a.split('.').map(BigInt)
  const right = b.split('.').map(BigInt)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  }
  return 0
}

function validateManifest(manifest) {
  if (manifest.name !== packageName || manifest.repository?.url !== `git+https://github.com/${repository}.git`) throw new Error('Invalid CLI package identity or repository')
}

export function validateRelease({ tag, repo, sha, manifest, branch = 'main', baseVersion = manifest.version, packed = false }) {
  if (repo !== repository) throw new Error('CLI releases must originate in slax-lab/slax-reader')
  if (!/^[a-f0-9]{40}$/.test(sha || '') || /^0+$/.test(sha)) throw new Error('Invalid source commit')
  if (!['dev', 'beta', 'main'].includes(branch)) throw new Error('Invalid CLI release branch')
  validateManifest(manifest)
  if (typeof baseVersion !== 'string' || baseVersion.trim() !== baseVersion || !stableVersion.test(baseVersion)) throw new Error('Expected a stable CLI base version')
  const channel = branch === 'main' ? 'stable' : branch
  const version = branch === 'main' ? baseVersion : `${baseVersion}-${branch}`
  if (manifest.version !== (packed ? version : baseVersion)) throw new Error('CLI manifest version does not match the release channel')
  if (tag !== `cli-v${version}`) throw new Error('Release tag must match the CLI package version and channel')
  return { name: packageName, baseVersion, version, channel, branch, tag, commit: sha, repository }
}

export function selectRelease({ previous, manifest, changed, branch, repo, sha }) {
  const version = branch === 'main' ? manifest.version : `${manifest.version}-${branch}`
  const release = validateRelease({ tag: `cli-v${version}`, repo, sha, manifest, branch })
  validateManifest(previous)
  const comparison = compareVersions(manifest.version, previous.version)
  if (comparison < 0) throw new Error(`CLI version decreased from ${previous.version} to ${manifest.version}`)
  if (!changed || comparison === 0) return { eligible: false, reason: !changed ? 'No CLI directory changes' : 'CLI version unchanged' }
  return { eligible: true, ...release }
}

export function preflight(env = process.env, cwd = root) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF_TYPE !== 'branch') throw new Error('Only release branch pushes can publish')
  const branch = env.GITHUB_REF_NAME
  if (!['dev', 'beta', 'main'].includes(branch) || env.GITHUB_REF !== `refs/heads/${branch}`) throw new Error('Invalid CLI release branch ref')
  if (env.GITHUB_REPOSITORY !== repository) throw new Error('CLI releases must originate in slax-lab/slax-reader')
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  if (event.ref !== env.GITHUB_REF || event.repository?.full_name !== repository || event.after !== env.GITHUB_SHA) throw new Error('Push event does not match the release source')
  if (event.created || event.deleted || event.forced) throw new Error('Branch creation, deletion and forced pushes cannot release')
  for (const sha of [event.before, event.after]) {
    if (!/^[a-f0-9]{40}$/.test(sha || '') || /^0+$/.test(sha)) throw new Error('Invalid push comparison revision')
  }
  const git = args => run('git', args, { cwd }).trim()
  if (git(['rev-parse', 'HEAD']) !== event.after) throw new Error('Checkout does not match the release commit')
  for (const sha of [event.before, event.after]) {
    try { git(['cat-file', '-e', `${sha}^{commit}`]) } catch { throw new Error(`Push comparison revision unavailable: ${sha}`) }
  }
  try { git(['merge-base', '--is-ancestor', event.before, event.after]) } catch { throw new Error('Release push must preserve branch history') }
  try { git(['merge-base', '--is-ancestor', event.after, `origin/${branch}`]) } catch { throw new Error(`Release commit must be reachable from origin/${branch}`) }
  const manifest = JSON.parse(git(['show', `${event.after}:apps/cli/package.json`]))
  const previous = JSON.parse(git(['show', `${event.before}:apps/cli/package.json`]))
  if (!isDeepStrictEqual(manifest, JSON.parse(readFileSync(resolve(cwd, 'apps/cli/package.json'), 'utf8')))) throw new Error('Working CLI manifest differs from the release source')
  return selectRelease({ previous, manifest, changed: Boolean(git(['diff', '--name-only', event.before, event.after, '--', 'apps/cli'])), branch, repo: env.GITHUB_REPOSITORY, sha: event.after })
}

function candidate(env) {
  const { eligible, reason, ...release } = preflight(env)
  if (!eligible) throw new Error(`No eligible CLI release: ${reason}`)
  return release
}

const notesPaths = ['apps/cli', 'packages/contracts', 'tooling/cli*.mjs', 'tooling/pnpm-command.mjs', '.github/workflows/cli-*.yml', 'docs/cli']
const cliTag = /^cli-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-(dev|beta))?$/
const isNotesPath = path => /^(apps\/cli|packages\/contracts|docs\/cli)\//.test(path) || /^tooling\/(cli[^/]*\.mjs|pnpm-command\.mjs)$/.test(path) || /^\.github\/workflows\/cli-[^/]*\.yml$/.test(path)

export function releaseNotes(release, cwd = root, fixedBaseline = undefined) {
  if (!/^[a-f0-9]{40}$/.test(release.commit || '') || /^0+$/.test(release.commit) || !['dev', 'beta', 'stable'].includes(release.channel)) throw new Error('Invalid release notes source identity')
  compareVersions(release.baseVersion, release.baseVersion)
  if (release.version !== (release.channel === 'stable' ? release.baseVersion : `${release.baseVersion}-${release.channel}`)) throw new Error('Invalid release notes version identity')
  const git = args => run('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') throw new Error('Release notes require complete Git history')
  git(['cat-file', '-e', `${release.commit}^{commit}`])
  const ancestor = commit => {
    try { git(['merge-base', '--is-ancestor', commit, release.commit]); return true }
    catch (error) { if (error.status === 1) return false; throw error }
  }
  let baseline = fixedBaseline
  if (baseline === undefined) {
    const tags = git(['tag', '--list', 'cli-v*']).trim().split('\n').filter(Boolean)
    const candidates = []
    for (const tag of tags) {
      const match = cliTag.exec(tag)
      if (!match || compareVersions(match[1], release.baseVersion) >= 0) continue
      const commit = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]).trim()
      if (ancestor(commit)) candidates.push({ tag, commit, version: match[1], channel: match[2] || 'stable' })
    }
    const same = candidates.filter(item => item.channel === release.channel)
    const eligible = same.length ? same : release.channel === 'stable' ? [] : candidates.filter(item => item.channel === 'stable')
    eligible.sort((a, b) => compareVersions(b.version, a.version))
    baseline = eligible.length ? { tag: eligible[0].tag, commit: eligible[0].commit } : null
  }
  if (baseline !== null) {
    const match = typeof baseline?.tag === 'string' && cliTag.exec(baseline.tag)
    if (!match || !/^[a-f0-9]{40}$/.test(baseline.commit || '') || compareVersions(match[1], release.baseVersion) >= 0 || ![release.channel, ...(release.channel === 'stable' ? [] : ['stable'])].includes(match[2] || 'stable')) throw new Error('Invalid release notes baseline')
    if (git(['rev-parse', '--verify', `refs/tags/${baseline.tag}^{commit}`]).trim() !== baseline.commit || !ancestor(baseline.commit)) throw new Error('Release notes baseline identity changed')
  }
  const range = baseline ? `${baseline.commit}..${release.commit}` : release.commit
  const net = baseline
    ? git(['diff', '--no-renames', '--name-only', '-z', baseline.commit, release.commit, '--', ...notesPaths])
    : git(['ls-tree', '-r', '--name-only', '-z', release.commit])
  const paths = new Set(net.split('\0').filter(isNotesPath))
  const commits = git(['log', '--full-history', '--reverse', '--topo-order', '--no-merges', '--format=%H', range, '--', ...notesPaths]).trim().split('\n').filter(Boolean)
  const groups = { 'CLI package and commands': [], 'Shared CLI contracts': [], 'CLI tooling and documentation': [] }
  const covered = new Set()
  const code = path => '`' + path.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('`', '&#96;').replaceAll('\n', '\\n').replaceAll('\r', '\\r') + '`'
  const add = (sha, changed) => {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid release notes source commit')
    for (const [title, accept] of [['CLI package and commands', path => path.startsWith('apps/cli/')], ['Shared CLI contracts', path => path.startsWith('packages/contracts/')], ['CLI tooling and documentation', path => !path.startsWith('apps/cli/') && !path.startsWith('packages/contracts/')]]) {
      const matching = changed.filter(accept)
      if (matching.length) groups[title].push(`- ${matching.map(code).join(', ')} ([${sha.slice(0, 7)}](https://github.com/${repository}/commit/${sha}))`)
    }
    for (const path of changed) covered.add(path)
  }
  for (const sha of commits) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid release notes history')
    const changed = git(['diff-tree', '--root', '--no-commit-id', '--no-renames', '--name-only', '-r', '-z', sha, '--', ...notesPaths]).split('\0').filter(path => paths.has(path))
    add(sha, changed)
  }
  // Include CLI-only conflict resolutions introduced by a merge, without using its repository-wide subject.
  add(release.commit, [...paths].filter(path => !covered.has(path)))
  const comparison = baseline ? `Compared with [${baseline.tag}](https://github.com/${repository}/releases/tag/${baseline.tag}).` : 'First release in this comparison scope; includes available CLI history.'
  const sections = Object.entries(groups).filter(([, entries]) => entries.length).map(([title, entries]) => `### ${title}\n\n${entries.join('\n')}`)
  const versionOnly = paths.size === 1 && paths.has('apps/cli/package.json') ? `CLI package version updated to ${release.version}.\n\n` : ''
  const body = `## CLI v${release.version}\n\nChannel: ${release.channel}\nSource: [${release.commit.slice(0, 7)}](https://github.com/${repository}/commit/${release.commit})\n\n${comparison}\n\n${versionOnly}${sections.length ? sections.join('\n\n') : 'No CLI file changes in this comparison.'}\n`
  if (Buffer.byteLength(body) > 100000) throw new Error('CLI release notes exceed the publication size limit')
  return { body, baseline }
}

export function prepareRelease(directory, env = process.env) {
  const release = candidate(env)
  const notes = releaseNotes(release)
  const destination = resolve(directory)
  mkdirSync(destination, { recursive: true })
  if (readdirSync(destination).length) throw new Error('Release output directory must be empty')
  const manifestPath = resolve(root, 'apps/cli/package.json')
  const original = readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(original)
  try {
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: release.version, gitHead: release.commit, slaxRelease: release }, null, 2) + '\n')
    const build = pnpmInvocation(['cli', '--', 'build'])
    run(build.program, build.args, { cwd: root, stdio: 'inherit' })
    const invocation = pnpmInvocation(['--dir', 'apps/cli', 'pack', '--pack-destination', destination])
    run(invocation.program, invocation.args, { cwd: root, stdio: 'inherit' })
  } finally {
    writeFileSync(manifestPath, original)
  }
  const archives = readdirSync(destination).filter(file => file.endsWith('.tgz'))
  if (archives.length !== 1) throw new Error('Expected one packed CLI archive')
  const filename = archives[0]
  const bytes = readFileSync(resolve(destination, filename))
  const metadata = { ...release, filename, integrity: `sha512-${digest(bytes, 'sha512', 'base64')}`, sha256: digest(bytes, 'sha256'), notes: { source: release.commit, baseline: notes.baseline, sha256: digest(notes.body, 'sha256') } }
  writeFileSync(resolve(destination, 'RELEASE_NOTES.md'), notes.body)
  writeFileSync(resolve(destination, 'release.json'), JSON.stringify(metadata, null, 2) + '\n')
  writeFileSync(resolve(destination, 'SHA256SUMS'), `${metadata.sha256}  ${filename}\n`)
  return metadata
}

export function readRelease(directory, { cwd } = {}) {
  const destination = resolve(directory)
  const release = JSON.parse(readFileSync(resolve(destination, 'release.json'), 'utf8'))
  if (typeof release.filename !== 'string' || release.filename !== basename(release.filename) || !/^[a-zA-Z0-9._-]+\.tgz$/.test(release.filename)) throw new Error('Invalid archive filename')
  const archive = resolve(destination, release.filename)
  const bytes = readFileSync(archive)
  if (release.sha256 !== digest(bytes, 'sha256') || release.integrity !== `sha512-${digest(bytes, 'sha512', 'base64')}`) throw new Error('Release artifact checksum mismatch')
  if (readFileSync(resolve(destination, 'SHA256SUMS'), 'utf8') !== `${release.sha256}  ${release.filename}\n`) throw new Error('Invalid checksum file')
  const manifest = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json']))
  const expected = validateRelease({ tag: release.tag, repo: release.repository, sha: release.commit, manifest, branch: release.branch, baseVersion: release.baseVersion, packed: true })
  if (!isDeepStrictEqual(manifest.slaxRelease, expected) || manifest.gitHead !== release.commit || !Object.entries(expected).every(([key, value]) => release[key] === value)) throw new Error('Archive source identity mismatch')
  const notes = readFileSync(resolve(destination, 'RELEASE_NOTES.md'), 'utf8')
  if (release.notes?.source !== release.commit || release.notes.sha256 !== digest(notes, 'sha256') || !Object.hasOwn(release.notes, 'baseline')) throw new Error('Release notes identity or checksum mismatch')
  if (cwd && releaseNotes(release, cwd, release.notes.baseline).body !== notes) throw new Error('Release notes differ from source history')
  return release
}

export async function registryVersion(version, fetcher = fetch) {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(30000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`npm registry request failed: ${response.status}`)
  return response.json()
}

export async function publishRelease(release, adapters) {
  if (release.channel !== 'stable' || release.branch !== 'main') throw new Error('Only main can publish npm packages')
  const existing = await adapters.version(release.version)
  const latest = await adapters.version('latest')
  if (existing) {
    if (existing.name !== packageName || existing.version !== release.version || existing.dist?.integrity !== release.integrity || !Object.entries(releaseIdentity(release)).every(([key, value]) => existing.slaxRelease?.[key] === value)) throw new Error('Published npm version conflicts with this release')
    await adapters.verifyRegistryArchive(existing.dist, release)
  } else {
    if (latest && compareVersions(release.version, latest.version) <= 0) throw new Error('New release must be newer than npm latest')
    await adapters.publish(release)
    const published = await adapters.version(release.version)
    if (!published || published.dist?.integrity !== release.integrity || published.slaxRelease?.commit !== release.commit) throw new Error('Published npm package could not be verified; rerun after registry propagation')
    await adapters.verifyRegistryArchive(published.dist, release)
  }
  await adapters.github(release)
}

async function githubRequest(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...options,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', ...options.headers },
    signal: AbortSignal.timeout(30000),
  })
  if (response.status === 404 && (!options.method || options.method === 'GET')) return null
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`)
  return response.json()
}

export async function reconcileAssets({ release, remote, assets, readAsset, uploadAsset }) {
  if (remote.tag_name !== release.tag || remote.draft || remote.prerelease !== (release.channel !== 'stable')) throw new Error('GitHub Release identity/state mismatch')
  for (const asset of assets) {
    const matches = remote.assets.filter(item => item.name === asset.name)
    if (matches.length > 1) throw new Error(`Duplicate release asset: ${asset.name}`)
    if (matches.length) {
      const bytes = await readAsset(matches[0])
      if (digest(bytes, 'sha256') !== digest(asset.bytes, 'sha256')) throw new Error(`Conflicting release asset: ${asset.name}`)
    } else {
      await uploadAsset(remote, asset)
    }
  }
}

function releaseIdentity(release) {
  const { name, baseVersion, version, channel, branch, tag, commit, repository: repo } = release
  return { name, baseVersion, version, channel, branch, tag, commit, repository: repo }
}

export async function ensureReleaseTag(release, request = githubRequest, { create = true } = {}) {
  let tag = await request(`/git/ref/tags/${release.tag}`)
  if (!tag && create) {
    tag = await request('/git/refs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/tags/${release.tag}`, sha: release.commit }),
    })
  }
  if (!tag) throw new Error(`Release tag is missing: ${release.tag}`)
  let object = tag.object
  for (let depth = 0; object?.type === 'tag' && depth < 5; depth++) {
    const annotation = await request(`/git/tags/${object.sha}`)
    if (!annotation) throw new Error('Annotated tag is missing')
    object = annotation.object
  }
  if (object?.type !== 'commit' || object.sha !== release.commit) throw new Error(`Release tag conflict: ${release.tag} expected ${release.commit}, found ${object?.sha}`)
}

async function githubRelease(release, directory) {
  await ensureReleaseTag(release, githubRequest, { create: false })
  let remote = await githubRequest(`/releases/tags/${release.tag}`)
  if (!remote) {
    const preview = release.channel !== 'stable'
    const newest = preview ? null : await githubRequest('/releases/latest')
    const newestVersion = newest?.tag_name?.startsWith('cli-v') ? newest.tag_name.slice(5) : null
    const makeLatest = !preview && (!newest || (stableVersion.test(newestVersion || '') && compareVersions(release.version, newestVersion) > 0))
    remote = await githubRequest('/releases', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: release.tag, target_commitish: release.commit, name: `CLI v${release.version}`, prerelease: preview, body: readFileSync(resolve(directory, 'RELEASE_NOTES.md'), 'utf8'), make_latest: makeLatest ? 'true' : 'false' }),
    })
    if (!remote) throw new Error('GitHub Release creation failed')
  }
  await reconcileAssets({
    release, remote,
    assets: [release.filename, 'SHA256SUMS'].map(name => ({ name, bytes: readFileSync(resolve(directory, name)) })),
    readAsset: async asset => {
      const response = await fetch(`https://api.github.com/repos/${repository}/releases/assets/${asset.id}`, {
        headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) throw new Error(`Asset download failed: ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    },
    uploadAsset: async (target, asset) => {
      await ensureReleaseTag(release, githubRequest, { create: false })
      const response = await fetch(`https://uploads.github.com/repos/${repository}/releases/${target.id}/assets?name=${encodeURIComponent(asset.name)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: asset.bytes, signal: AbortSignal.timeout(60000),
      })
      if (!response.ok) throw new Error(`Release asset upload failed: ${response.status}`)
    },
  })
}

async function main() {
  const [command, directory = '.local/cli-release'] = process.argv.slice(2)
  if (command === 'detect' || command === 'preflight') {
    const selected = preflight()
    console.log(JSON.stringify(selected))
    if (command === 'detect') {
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `eligible=${selected.eligible}\n`)
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, selected.eligible ? `CLI release: ${selected.tag} at ${selected.commit}\n` : `CLI release skipped: ${selected.reason}\n`)
    }
  } else if (command === 'prepare') {
    console.log(JSON.stringify(prepareRelease(directory)))
  } else if (command === 'verify' || command === 'smoke') {
    const expected = candidate(process.env)
    const release = readRelease(directory, { cwd: root })
    if (!isDeepStrictEqual(releaseIdentity(release), expected)) throw new Error('Downloaded artifact differs from the release event')
    if (command === 'smoke') {
      const smoke = pnpmInvocation(['cli', '--', 'test:package', resolve(directory, release.filename), release.version])
      run(smoke.program, smoke.args, { cwd: root, stdio: 'inherit' })
    }
    console.log(JSON.stringify(release))
  } else if (command === 'publish' || command === 'preview') {
    const expected = candidate(process.env)
    const release = readRelease(directory, { cwd: root })
    if (!isDeepStrictEqual(releaseIdentity(release), expected)) throw new Error('Downloaded artifact differs from the release event')
    if ((command === 'publish') !== (release.channel === 'stable')) throw new Error('Distribution command does not match the release channel')
    if (!process.env.GH_TOKEN) throw new Error('GitHub workflow token is required')
    await ensureReleaseTag(release)
    await ensureReleaseTag(release, githubRequest, { create: false })
    if (command === 'preview') {
      await githubRelease(release, resolve(directory))
      return
    }
    const npmVersion = run('npm', ['--version']).trim()
    if (compareVersions(npmVersion, '11.5.1') < 0) throw new Error('npm >=11.5.1 is required for trusted publishing')
    await publishRelease(release, {
      version: registryVersion,
      verifyRegistryArchive: async (dist, candidate) => {
        const url = new URL(dist.tarball)
        if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw new Error('Unexpected registry archive URL')
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
        if (!response.ok) throw new Error('Registry archive download failed')
        if (`sha512-${digest(Buffer.from(await response.arrayBuffer()), 'sha512', 'base64')}` !== candidate.integrity) throw new Error('Registry archive bytes differ')
      },
      publish: async () => {
        await ensureReleaseTag(release, githubRequest, { create: false })
        run('npm', ['publish', resolve(directory, release.filename), '--access', 'public', '--tag', 'latest', '--provenance', '--ignore-scripts'], { cwd: root, stdio: 'inherit' })
      },
      github: candidate => githubRelease(candidate, resolve(directory)),
    })
  } else {
    throw new Error('Usage: node tooling/cli-release.mjs <detect|preflight|prepare|verify|smoke|preview|publish> [artifact-directory]')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
