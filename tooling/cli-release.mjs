import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pnpmInvocation } from './pnpm-command.mjs'

export const repository = 'slax-lab/slax-reader'
export const packageName = '@slax-lab/reader-cli'
const root = fileURLToPath(new URL('../', import.meta.url))
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const digest = (bytes, algorithm, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)
const run = (program, args, options = {}) => execFileSync(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })

export function compareVersions(a, b) {
  if (!stableVersion.test(a) || !stableVersion.test(b)) throw new Error('Expected stable semantic versions')
  const left = a.split('.').map(BigInt)
  const right = b.split('.').map(BigInt)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  }
  return 0
}

export function validateRelease({ tag, repo, sha, manifest }) {
  if (repo !== repository) throw new Error('CLI releases must originate in slax-lab/slax-reader')
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid source commit')
  if (manifest.name !== packageName || !stableVersion.test(manifest.version)) throw new Error('Invalid CLI package identity or stable version')
  if (tag !== `cli-v${manifest.version}`) throw new Error('Release tag must match the stable CLI package version')
  if (manifest.repository?.url !== `git+https://github.com/${repository}.git`) throw new Error('Package repository does not match publisher')
  return { name: packageName, version: manifest.version, tag, commit: sha, repository }
}

export function preflight(env = process.env) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'apps/cli/package.json'), 'utf8'))
  const release = validateRelease({ tag: env.GITHUB_REF_NAME, repo: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA, manifest })
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF_TYPE !== 'tag') throw new Error('Only pushed release tags can publish')
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim()
  if (head !== release.commit) throw new Error('Checkout does not match the release commit')
  run('git', ['merge-base', '--is-ancestor', release.commit, 'origin/main'], { cwd: root })
  const target = run('git', ['rev-parse', `refs/tags/${release.tag}^{commit}`], { cwd: root }).trim()
  if (target !== head) throw new Error('Release tag does not resolve to the checked-out commit')
  return release
}

export function prepareRelease(directory, env = process.env) {
  const release = preflight(env)
  const destination = resolve(directory)
  mkdirSync(destination, { recursive: true })
  if (readdirSync(destination).length) throw new Error('Release output directory must be empty')
  const manifestPath = resolve(root, 'apps/cli/package.json')
  const original = readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(original)
  try {
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, gitHead: release.commit, slaxRelease: release }, null, 2) + '\n')
    const invocation = pnpmInvocation(['--dir', 'apps/cli', 'pack', '--pack-destination', destination])
    run(invocation.program, invocation.args, { cwd: root, stdio: 'inherit' })
  } finally {
    writeFileSync(manifestPath, original)
  }
  const archives = readdirSync(destination).filter(file => file.endsWith('.tgz'))
  if (archives.length !== 1) throw new Error('Expected one packed CLI archive')
  const filename = archives[0]
  const bytes = readFileSync(resolve(destination, filename))
  const metadata = { ...release, filename, integrity: `sha512-${digest(bytes, 'sha512', 'base64')}`, sha256: digest(bytes, 'sha256') }
  writeFileSync(resolve(destination, 'release.json'), JSON.stringify(metadata, null, 2) + '\n')
  writeFileSync(resolve(destination, 'SHA256SUMS'), `${metadata.sha256}  ${filename}\n`)
  return metadata
}

export function readRelease(directory) {
  const destination = resolve(directory)
  const release = JSON.parse(readFileSync(resolve(destination, 'release.json'), 'utf8'))
  if (typeof release.filename !== 'string' || release.filename !== basename(release.filename) || !/^[a-zA-Z0-9._-]+\.tgz$/.test(release.filename)) throw new Error('Invalid archive filename')
  const archive = resolve(destination, release.filename)
  const bytes = readFileSync(archive)
  if (release.sha256 !== digest(bytes, 'sha256') || release.integrity !== `sha512-${digest(bytes, 'sha512', 'base64')}`) throw new Error('Release artifact checksum mismatch')
  if (readFileSync(resolve(destination, 'SHA256SUMS'), 'utf8') !== `${release.sha256}  ${release.filename}\n`) throw new Error('Invalid checksum file')
  const manifest = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json']))
  const expected = validateRelease({ tag: release.tag, repo: release.repository, sha: release.commit, manifest })
  if (JSON.stringify(manifest.slaxRelease) !== JSON.stringify(expected) || manifest.gitHead !== release.commit || release.version !== manifest.version || release.name !== packageName) throw new Error('Archive source identity mismatch')
  return release
}

export async function registryVersion(version, fetcher = fetch) {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(30000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`npm registry request failed: ${response.status}`)
  return response.json()
}

export async function publishRelease(release, adapters) {
  const existing = await adapters.version(release.version)
  const latest = await adapters.version('latest')
  if (existing) {
    if (existing.name !== packageName || existing.version !== release.version || existing.dist?.integrity !== release.integrity || existing.slaxRelease?.commit !== release.commit || existing.slaxRelease?.tag !== release.tag || existing.slaxRelease?.repository !== repository) throw new Error('Published npm version conflicts with this release')
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
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`)
  return response.json()
}

export async function reconcileAssets({ release, remote, assets, readAsset, uploadAsset }) {
  if (remote.tag_name !== release.tag || remote.draft || remote.prerelease) throw new Error('GitHub Release identity/state mismatch')
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

async function githubRelease(release, directory) {
  if (!process.env.GH_TOKEN) throw new Error('GitHub workflow token is required')
  const tag = await githubRequest(`/git/ref/tags/${release.tag}`)
  if (!tag) throw new Error('Release tag is missing')
  let object = tag.object
  for (let depth = 0; object.type === 'tag' && depth < 5; depth++) {
    const annotation = await githubRequest(`/git/tags/${object.sha}`)
    if (!annotation) throw new Error('Annotated tag is missing')
    object = annotation.object
  }
  if (object.type !== 'commit' || object.sha !== release.commit) throw new Error('Remote release tag changed')
  let remote = await githubRequest(`/releases/tags/${release.tag}`)
  if (!remote) {
    const newest = await githubRequest('/releases/latest')
    const newestVersion = newest?.tag_name?.startsWith('cli-v') ? newest.tag_name.slice(5) : null
    const makeLatest = !newest || (stableVersion.test(newestVersion || '') && compareVersions(release.version, newestVersion) > 0)
    remote = await githubRequest('/releases', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: release.tag, target_commitish: release.commit, name: `CLI v${release.version}`, generate_release_notes: true, make_latest: makeLatest ? 'true' : 'false' }),
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
      const response = await fetch(`https://uploads.github.com/repos/${repository}/releases/${target.id}/assets?name=${encodeURIComponent(asset.name)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: asset.bytes, signal: AbortSignal.timeout(60000),
      })
      if (!response.ok) throw new Error(`Release asset upload failed: ${response.status}`)
    },
  })
}

async function main() {
  const [command, directory = '.local/cli-release'] = process.argv.slice(2)
  if (command === 'preflight') {
    console.log(JSON.stringify(preflight()))
  } else if (command === 'prepare') {
    console.log(JSON.stringify(prepareRelease(directory)))
  } else if (command === 'publish') {
    const expected = preflight()
    const release = readRelease(directory)
    if (release.commit !== expected.commit || release.tag !== expected.tag) throw new Error('Downloaded artifact differs from the release event')
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
      publish: () => run('npm', ['publish', resolve(directory, release.filename), '--access', 'public', '--tag', 'latest', '--provenance', '--ignore-scripts'], { cwd: root, stdio: 'inherit' }),
      github: candidate => githubRelease(candidate, resolve(directory)),
    })
  } else {
    throw new Error('Usage: node tooling/cli-release.mjs <preflight|prepare|publish> [artifact-directory]')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
