import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEnvironment, mergedPullRequest, packageName, profiles, releaseIdentity, repository, selectRelease, validateBuildConfig } from './extension-release.mjs'

const sha = 'a'.repeat(40)
const manifest = { name: packageName, version: '1.2.3' }
const select = (options = {}) => selectRelease({ manifest, previous: { ...manifest, version: '1.2.2' }, branch: 'dev', sha, changed: true, ...options })
const config = { PUBLIC_BASE_URL: 'https://reader.example.test', AUTH_BASE_URL: 'https://reader.example.test', SHARE_BASE_URL: 'https://share.example.test', EXTENSIONS_API_BASE_URL: 'https://api.example.test', COOKIE_DOMAIN: '.example.test', COOKIE_TOKEN_NAME: 'slax_test' }

test('versions select all channels, version-only increases and destination promotions', () => {
  for (const branch of ['dev', 'beta', 'main']) {
    const release = select({ branch })
    const display = branch === 'main' ? '1.2.3' : `1.2.3-${branch}`
    assert.equal(release.eligible, true)
    assert.equal(release.tag, `ext-v${display}`)
    assert.equal(release.filename, `slax-reader-extension-${display}-chrome.zip`)
    assert.equal(release.profile, profiles[branch].profile)
    assert.equal(release.baseVersion, '1.2.3')
    assert.equal(release.commit, sha)
  }
  assert.equal(select({ changed: false }).eligible, false)
  assert.equal(select({ previous: manifest }).eligible, false)
  assert.equal(select({ previous: { ...manifest, version: '1.0.0' } }).eligible, true)
  for (const version of ['0.0.0', '01.2.3', '1.2', '1.2.3-dev', '65536.0.0', '1.2.3.4', '1.2.3\n']) {
    assert.throws(() => select({ manifest: { ...manifest, version } }), /Chrome-compatible/)
  }
  assert.throws(() => select({ previous: { ...manifest, version: '1.2.4' } }), /decreased/)
  for (const options of [{ branch: 'feature/task' }, { repo: 'other/repo' }, { sha: '0'.repeat(40) }, { manifest: { ...manifest, name: 'other' } }]) assert.throws(() => select(options))
})

test('public config rejects credentials, invalid shapes and non-HTTPS endpoints without echoing values', () => {
  assert.deepEqual(validateBuildConfig(JSON.stringify(config)), config)
  for (const value of [undefined, '', 'null', '[]', '{', JSON.stringify({ ...config, SLAX_ENV: 'production' }), JSON.stringify({ ...config, GOOGLE_ANALYTICS_API_SECRET: 'SENSITIVE' })]) assert.throws(() => validateBuildConfig(value))
  for (const key of Object.keys(config)) {
    const missing = { ...config }; delete missing[key]
    assert.throws(() => validateBuildConfig(JSON.stringify(missing)), new RegExp(key))
    assert.throws(() => validateBuildConfig(JSON.stringify({ ...config, [key]: ['invalid'] })))
  }
  for (const value of ['http://api.example.test', 'https://user:SENSITIVE@api.example.test', 'https://api.example.test/#SENSITIVE', 'invalid', 'https://api.example.test\nSENSITIVE']) {
    assert.throws(() => validateBuildConfig(JSON.stringify({ ...config, EXTENSIONS_API_BASE_URL: value })), error => !error.message.includes('SENSITIVE'))
  }
  assert.throws(() => validateBuildConfig(JSON.stringify({ ...config, COOKIE_TOKEN_NAME: 'x' })))
  assert.throws(() => validateBuildConfig(JSON.stringify({ ...config, COOKIE_DOMAIN: 'https://example.test' })))
  const clean = buildEnvironment(config, 'preview', { PATH: '/bin', HOME: '/fixture', GH_TOKEN: 'SENSITIVE', NODE_OPTIONS: '--import attack', SLAX_ENV: 'production', GOOGLE_ANALYTICS_API_SECRET: 'SENSITIVE', CLOUDFLARE_API_TOKEN: 'SENSITIVE' })
  assert.equal(clean.SLAX_ENV, 'preview')
  assert.equal(clean.GOOGLE_ANALYTICS_API_SECRET, '')
  assert.equal(clean.PATH, '/bin')
  assert.ok(!JSON.stringify(clean).includes('SENSITIVE'))
  assert.equal(clean.NODE_OPTIONS, undefined)
})

test('merged PR proof checks exact merged revision, base repository and branch, with bounded retry', async () => {
  const release = releaseIdentity({ manifest, branch: 'dev', sha })
  const match = { number: 42, merged_at: '2026-10-15', merge_commit_sha: sha, base: { ref: 'dev', repo: { full_name: repository } } }
  const pause = async () => {}
  // GitHub reports the final merge, squash, or rebased commit as merge_commit_sha.
  for (const branch of ['dev', 'beta', 'main']) {
    assert.equal(await mergedPullRequest({ ...release, branch }, async () => [{ ...match, base: { ...match.base, ref: branch } }], { sleep: pause }), 42)
  }
  for (const invalid of [{ ...match, merged_at: null }, { ...match, merge_commit_sha: 'b'.repeat(40) }, { ...match, base: { ref: 'main', repo: match.base.repo } }, { ...match, base: { ...match.base, repo: { full_name: 'other/repo' } } }]) {
    let reads = 0
    assert.equal(await mergedPullRequest(release, async () => { reads++; return [invalid] }, { sleep: pause }), null)
    assert.equal(reads, 3)
  }
  let reads = 0
  assert.equal(await mergedPullRequest(release, async () => { if (++reads === 1) throw Error('Network unavailable'); return [match] }, { sleep: pause }), 42)
  reads = 0
  assert.equal(await mergedPullRequest(release, async () => ++reads === 1 ? [] : [match], { sleep: pause }), 42)
  await assert.rejects(mergedPullRequest(release, async () => { throw Error('Authentication failed') }, { sleep: pause }), /Authentication/)
  await assert.rejects(mergedPullRequest(release, async () => null, { sleep: pause }), /Invalid/)
  const pages = []
  assert.equal(await mergedPullRequest(release, async path => { pages.push(path); return pages.length === 1 ? Array(100).fill({}) : [match] }, { sleep: pause }), 42)
  assert.match(pages[1], /page=2$/)
})
