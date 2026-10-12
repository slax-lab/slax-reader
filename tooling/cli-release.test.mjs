import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, validateRelease, publishRelease, registryVersion, reconcileAssets, repository, packageName } from './cli-release.mjs'
import { readFileSync } from 'node:fs'

const commit = 'a'.repeat(40)
const manifest = { name: packageName, version: '2.0.0', repository: { url: `git+https://github.com/${repository}.git` } }
const release = { ...validateRelease({ tag: 'cli-v2.0.0', repo: repository, sha: commit, manifest }), integrity: 'sha512-fixture' }
const published = { ...manifest, dist: { integrity: release.integrity }, slaxRelease: release }

function adapters({ existing = null, latest = { version: '1.0.0' } } = {}) {
  const calls = []
  let current = existing
  return {
    calls,
    version: async version => version === 'latest' ? latest : current,
    publish: async () => { calls.push('npm'); current = published },
    verifyRegistryArchive: async () => calls.push('verify'),
    github: async () => calls.push('github'),
  }
}

test('release guards enforce repository, stable tag and package identity', () => {
  assert.equal(release.version, '2.0.0')
  for (const values of [
    { tag: 'v2.0.0' }, { tag: 'cli-v1.0.0' }, { repo: 'fork/reader' }, { sha: 'HEAD' },
    { tag: 'cli-v2.0.0-beta.1', manifest: { ...manifest, version: '2.0.0-beta.1' } },
    { manifest: { ...manifest, name: 'other' } },
    { manifest: { ...manifest, repository: { url: 'https://example.com' } } },
  ]) assert.throws(() => validateRelease({ tag: release.tag, repo: repository, sha: commit, manifest, ...values }))
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0)
  assert.equal(compareVersions('2.0.0', '20.0.0'), -1)
  assert.throws(() => compareVersions('2.0.0-beta.1', '2.0.0'))
})

test('fresh release publishes, verifies registry bytes, then creates GitHub outputs', async () => {
  const api = adapters()
  await publishRelease(release, api)
  assert.deepEqual(api.calls, ['npm', 'verify', 'github'])
})

test('retry after npm success verifies identity and only reconciles GitHub outputs', async () => {
  const api = adapters({ existing: published, latest: { version: '3.0.0' } })
  await publishRelease(release, api)
  assert.deepEqual(api.calls, ['verify', 'github'])
})

test('conflicting package or source commit fails without writes', async () => {
  for (const existing of [
    { ...published, dist: { integrity: 'different' } },
    { ...published, slaxRelease: { ...release, commit: 'b'.repeat(40) } },
    { ...published, name: 'other' },
    { ...published, slaxRelease: undefined },
  ]) {
    const api = adapters({ existing })
    await assert.rejects(publishRelease(release, api), /conflicts/)
    assert.deepEqual(api.calls, [])
  }
})

test('missing old versions never regress latest and publishing failures never create releases', async () => {
  const old = adapters({ latest: { version: '3.0.0' } })
  await assert.rejects(publishRelease(release, old), /newer/)
  assert.deepEqual(old.calls, [])
  const failed = adapters()
  failed.publish = async () => { throw new Error('npm failed') }
  await assert.rejects(publishRelease(release, failed), /npm failed/)
  assert.deepEqual(failed.calls, [])
})

test('registry errors are not missing versions', async () => {
  assert.equal(await registryVersion('2.0.0', async () => new Response('', { status: 404 })), null)
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(registryVersion('2.0.0', async () => new Response('', { status })), new RegExp(String(status)))
  }
  await assert.rejects(registryVersion('2.0.0', async () => { throw new Error('offline') }), /offline/)
  const api = adapters()
  api.version = async () => { throw new Error('offline') }
  await assert.rejects(publishRelease(release, api), /offline/)
  assert.deepEqual(api.calls, [])
})

test('release asset retries add only missing identical artifacts without overwrites', async () => {
  const assets = [{ name: 'cli.tgz', bytes: Buffer.from('package') }, { name: 'SHA256SUMS', bytes: Buffer.from('checksum') }]
  const uploads = []
  const options = {
    release, remote: { tag_name: release.tag, draft: false, prerelease: false, assets: [{ name: 'cli.tgz' }] }, assets,
    readAsset: async () => Buffer.from('package'),
    uploadAsset: async (_remote, asset) => uploads.push(asset.name),
  }
  await reconcileAssets(options)
  assert.deepEqual(uploads, ['SHA256SUMS'])
  await assert.rejects(reconcileAssets({ ...options, readAsset: async () => Buffer.from('conflicting') }), /Conflicting/)
  await assert.rejects(reconcileAssets({ ...options, remote: { ...options.remote, draft: true } }), /state/)
  await assert.rejects(reconcileAssets({ ...options, remote: { ...options.remote, assets: [{ name: 'cli.tgz' }, { name: 'cli.tgz' }] } }), /Duplicate/)
})

test('workflow publishes only tested tag artifacts with scoped OIDC and no long-lived token', () => {
  const workflow = readFileSync(new URL('../.github/workflows/cli-release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /tags:\s+- 'cli-v\*'/)
  assert.doesNotMatch(workflow, /pull_request|workflow_dispatch|secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN/)
  assert.match(workflow, /needs: build/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /test:package "\$archive"/)
  assert.match(workflow, /GH_TOKEN: \$\{\{ github.token \}\}/)
})

test('full validation runs on pull requests without repeating after merge or before release', () => {
  const ci = readFileSync(new URL('../.github/workflows/cli-ci.yml', import.meta.url), 'utf8')
  const releaseWorkflow = readFileSync(new URL('../.github/workflows/cli-release.yml', import.meta.url), 'utf8')
  assert.match(ci, /^  pull_request:/m)
  assert.doesNotMatch(ci, /^  push:/m)
  for (const command of ['pnpm cli -- typecheck', 'pnpm cli -- test', 'pnpm test:cli-tooling', 'pnpm test:preflight', 'pnpm cli -- test:package']) {
    assert.ok(ci.split('\n').some(line => line.trim() === `- run: ${command}`), command)
  }
  assert.match(releaseWorkflow, /^      - run: pnpm cli -- build$/m)
  assert.doesNotMatch(releaseWorkflow, /^      - run: pnpm (?:cli -- (?:typecheck|test)|test:cli-tooling|test:preflight)$/m)
  assert.match(releaseWorkflow, /pnpm cli -- test:package "\$archive"/)
  assert.ok(releaseWorkflow.indexOf('pnpm cli -- build') < releaseWorkflow.indexOf('cli-release.mjs prepare'))
  assert.ok(releaseWorkflow.indexOf('test:package "\$archive"') < releaseWorkflow.indexOf('actions/upload-artifact'))
})
