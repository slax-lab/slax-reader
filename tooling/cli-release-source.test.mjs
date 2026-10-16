import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preflight, packageName, repository } from './cli-release.mjs'

function history(t, { previous = '1.0.1', version = '1.0.2', cliChange = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cli-release-history-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'dev')
  git('config', 'user.name', 'Release fixture')
  git('config', 'user.email', 'release@example.test')
  git('config', 'core.hooksPath', '/dev/null')
  mkdirSync(join(root, 'apps/cli'), { recursive: true })
  const manifestPath = join(root, 'apps/cli/package.json')
  const manifest = { name: packageName, version: previous, repository: { url: `git+https://github.com/${repository}.git` } }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  git('add', '.')
  git('commit', '-m', 'Initial CLI fixture')
  const before = git('rev-parse', 'HEAD')
  if (version !== previous) writeFileSync(manifestPath, JSON.stringify({ ...manifest, version }))
  writeFileSync(join(root, cliChange ? 'apps/cli/change.txt' : 'unrelated.txt'), 'fixture')
  git('add', '.')
  git('commit', '-m', 'Candidate fixture')
  const after = git('rev-parse', 'HEAD')
  for (const branch of ['dev', 'beta', 'main']) git('update-ref', `refs/remotes/origin/${branch}`, after)
  const eventPath = join(root, 'push.json')
  const event = { before, after, ref: 'refs/heads/dev', repository: { full_name: repository } }
  const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'dev', GITHUB_REF: event.ref, GITHUB_SHA: after, GITHUB_REPOSITORY: repository, GITHUB_EVENT_PATH: eventPath }
  const select = (branch = 'dev', changes = {}, environment = {}) => {
    writeFileSync(eventPath, JSON.stringify({ ...event, ref: `refs/heads/${branch}`, ...changes }))
    return preflight({ ...env, GITHUB_REF_NAME: branch, GITHUB_REF: `refs/heads/${branch}`, ...environment }, root)
  }
  return { root, git, before, after, select, manifestPath }
}

test('actual Git push history selects version-only changes and all promotion channels', t => {
  const f = history(t)
  for (const branch of ['dev', 'beta', 'main']) {
    const release = f.select(branch)
    assert.equal(release.eligible, true)
    assert.equal(release.baseVersion, '1.0.2')
    assert.equal(release.version, branch === 'main' ? '1.0.2' : `1.0.2-${branch}`)
    assert.equal(release.commit, f.after)
  }
  writeFileSync(join(f.root, 'later.txt'), 'later')
  f.git('add', 'later.txt')
  f.git('commit', '-m', 'Later unrelated merge')
  f.git('update-ref', 'refs/remotes/origin/dev', f.git('rev-parse', 'HEAD'))
  f.git('checkout', '--detach', f.after)
  assert.equal(f.select().commit, f.after)
})

test('unchanged CLI versions and unrelated merges skip without a release', t => {
  for (const cliChange of [false, true]) {
    const f = history(t, { version: '1.0.1', cliChange })
    assert.equal(f.select().eligible, false)
  }
})

test('promotion releases only its resulting version and rejects downgrades', t => {
  assert.equal(history(t, { version: '4.9.3' }).select('beta').version, '4.9.3-beta')
  assert.throws(() => history(t, { version: '1.0.0' }).select(), /decreased/)
  assert.throws(() => history(t, { version: '1.0.2-dev' }).select(), /stable/)
})

test('source guards reject malformed events, wrong checkout, missing commits and unreachable channels', t => {
  const f = history(t)
  for (const flag of ['forced', 'created', 'deleted']) assert.throws(() => f.select('dev', { [flag]: true }), /cannot release/)
  assert.throws(() => f.select('dev', { before: '0'.repeat(40) }), /comparison revision/)
  assert.throws(() => f.select('dev', { before: 'b'.repeat(40) }), /unavailable/)
  assert.throws(() => f.select('dev', { after: 'b'.repeat(40) }), /does not match/)
  assert.throws(() => f.select('dev', { repository: { full_name: 'fork/reader' } }), /does not match/)
  assert.throws(() => f.select('dev', {}, { GITHUB_EVENT_NAME: 'pull_request' }), /Only release branch/)
  assert.throws(() => f.select('dev', {}, { GITHUB_REF_TYPE: 'tag' }), /Only release branch/)
  assert.throws(() => f.select('dev', {}, { GITHUB_REPOSITORY: 'fork/reader' }), /originate/)
  assert.throws(() => f.select('other'), /branch ref/)
  f.git('update-ref', 'refs/remotes/origin/main', f.before)
  assert.throws(() => f.select('main'), /reachable from origin\/main/)
  const original = readFileSync(f.manifestPath)
  writeFileSync(f.manifestPath, '{}')
  assert.throws(() => f.select(), /Working CLI manifest/)
  writeFileSync(f.manifestPath, original)
  f.git('checkout', '--detach', f.before)
  assert.throws(() => f.select(), /Checkout/)
  writeFileSync(join(f.root, 'parallel.txt'), 'parallel')
  f.git('add', 'parallel.txt')
  f.git('commit', '-m', 'Unrelated history')
  const unrelated = f.git('rev-parse', 'HEAD')
  f.git('checkout', '--detach', f.after)
  assert.throws(() => f.select('dev', { before: unrelated }), /preserve branch history/)

})
