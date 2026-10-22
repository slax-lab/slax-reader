import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, validateRelease, publishRelease, registryVersion, reconcileAssets, ensureReleaseTag, selectRelease, repository, packageName } from './cli-release.mjs'
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
  assert.throws(() => compareVersions('2.0.0' + String.fromCharCode(10), '1.0.0'))
  assert.throws(() => compareVersions(['2.0.0'], '1.0.0'))
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

test('workflow scopes branch releases, exact artifact transfer, and stable-only OIDC', () => {
  const workflow = readFileSync(new URL('../.github/workflows/cli-release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /branches:\s+- dev\s+- beta\s+- main/)
  assert.doesNotMatch(workflow, /tags:|pull_request|workflow_dispatch|secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN/)
  assert.match(workflow, /needs.detect.outputs.eligible == 'true'/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /queue: max/)
  assert.match(workflow, /group: cli-release-\$\{\{ github.ref \}\}/)
  const preview = workflow.split('  preview:')[1].split('  publish:')[0]
  const stable = workflow.split('  publish:')[1]
  assert.match(preview, /refs\/heads\/dev.*refs\/heads\/beta/)
  assert.match(preview, /contents: write/)
  assert.doesNotMatch(preview, /id-token|npm install|registry-url|cli-release.mjs publish/)
  assert.match(stable, /if: github.ref == 'refs\/heads\/main'/)
  assert.match(stable, /id-token: write/)
  assert.match(stable, /contents: write/)
  assert.match(workflow, /GH_TOKEN: \$\{\{ github.token \}\}/)
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/)
  assert.ok(workflow.indexOf('cli-release.mjs prepare') < workflow.indexOf('cli-release.mjs smoke'))
  assert.ok(workflow.indexOf('cli-release.mjs smoke') < workflow.indexOf('actions/upload-artifact'))
  assert.match(workflow, /artifact_id: \$\{\{ steps.release_artifact.outputs.artifact-id \}\}/)
  assert.match(workflow, /name: cli-release-\$\{\{ github.sha \}\}-\$\{\{ github.ref_name \}\}-\$\{\{ github.run_attempt \}\}/)
  assert.equal([...workflow.matchAll(/artifact-ids: \$\{\{ needs.build.outputs.artifact_id \}\}/g)].length, 2)
  assert.equal([...workflow.matchAll(/merge-multiple: true/g)].length, 2)
  assert.doesNotMatch(workflow, /overwrite: true/)
})

test('full validation remains in PR CI and release preparation builds explicitly', () => {
  const ci = readFileSync(new URL('../.github/workflows/cli-ci.yml', import.meta.url), 'utf8')
  const workflow = readFileSync(new URL('../.github/workflows/cli-release.yml', import.meta.url), 'utf8')
  assert.match(ci, /^  pull_request:/m)
  assert.doesNotMatch(ci, /^  push:/m)
  for (const command of ['pnpm cli -- typecheck', 'pnpm cli -- test', 'pnpm cli -- test:package']) {
    assert.ok(ci.split('\n').some(line => line.trim() === `- run: ${command}`), command)
  }
  const tooling = readFileSync(new URL('../.github/workflows/tooling-ci.yml', import.meta.url), 'utf8')
  for (const command of ['pnpm test:cli-tooling', 'pnpm test:preflight']) assert.ok(tooling.includes(`run: ${command}`))
  assert.doesNotMatch(workflow, /^      - run: pnpm (?:cli -- (?:typecheck|test)|test:cli-tooling|test:preflight)$/m)
  assert.match(workflow, /cli-release.mjs prepare/)
  assert.match(workflow, /cli-release.mjs smoke/)
})

test('every channel derives arbitrary versions and previews cannot publish npm', async () => {
  for (const baseVersion of ['1.0.2', '3.7.11', '10.0.0']) {
    for (const branch of ['dev', 'beta', 'main']) {
      const version = branch === 'main' ? baseVersion : `${baseVersion}-${branch}`
      const candidate = selectRelease({ previous: { ...manifest, version: '1.0.1' }, manifest: { ...manifest, version: baseVersion }, branch, repo: repository, sha: commit, changed: true })
      assert.equal(candidate.tag, `cli-v${version}`)
      assert.equal(candidate.version, version)
      assert.equal(candidate.baseVersion, baseVersion)
      if (branch !== 'main') {
        const api = adapters()
        await assert.rejects(publishRelease(candidate, api), /Only main/)
        assert.deepEqual(api.calls, [])
      }
    }
  }
})

test('remote tags are created at exact commits, dereferenced, and never rewritten', async () => {
  const writes = []
  let tag = null
  const request = async (path, options = {}) => {
    if (options.method) {
      writes.push({ path, ...JSON.parse(options.body) })
      tag = { object: { type: 'commit', sha: commit } }
    }
    return tag
  }
  await ensureReleaseTag(release, request)
  await ensureReleaseTag(release, request)
  assert.deepEqual(writes, [{ path: '/git/refs', ref: release.tag.replace(/^/, 'refs/tags/'), sha: commit }])
  await ensureReleaseTag(release, async path => path.includes('/git/ref/') ? { object: { type: 'tag', sha: 'b'.repeat(40) } } : { object: { type: 'commit', sha: commit } })
  tag = { object: { type: 'commit', sha: 'c'.repeat(40) } }
  await assert.rejects(ensureReleaseTag(release, request), /conflict/)
  assert.equal(writes.length, 1)
  await assert.rejects(ensureReleaseTag(release, async () => null, { create: false }), /missing/)
  await assert.rejects(ensureReleaseTag(release, async () => { throw new Error('permission denied') }), /permission/)
})
