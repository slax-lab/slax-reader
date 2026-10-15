import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preflight, packageName, repository } from './extension-release.mjs'

function history(t, { previous = '1.0.1', version = '1.0.2', extensionChange = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'extension-release-history-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'dev')
  git('config', 'user.name', 'Release fixture')
  git('config', 'user.email', 'release@example.test')
  git('config', 'core.hooksPath', '/dev/null')
  git('config', 'commit.gpgsign', 'false')
  mkdirSync(join(root, 'apps/extension'), { recursive: true })
  const manifestPath = join(root, 'apps/extension/package.json')
  const manifest = { name: packageName, version: previous }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  git('add', '.')
  git('commit', '-m', 'Initial extension fixture')
  const before = git('rev-parse', 'HEAD')
  if (version !== previous) writeFileSync(manifestPath, JSON.stringify({ ...manifest, version }))
  writeFileSync(join(root, extensionChange ? 'apps/extension/change.txt' : 'unrelated.txt'), 'fixture')
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
  return { root, git, before, after, select, manifestPath, env }
}

test('full Git history supports version-only changes, promotions and queued original revisions', t => {
  const f = history(t)
  for (const branch of ['dev', 'beta', 'main']) assert.equal(f.select(branch).eligible, true)
  // Advance the branch; an immutable queued event still releases its original SHA.
  writeFileSync(join(f.root, 'later.txt'), 'later')
  f.git('add', 'later.txt'); f.git('commit', '-m', 'Later merge')
  const later = f.git('rev-parse', 'HEAD')
  f.git('update-ref', 'refs/remotes/origin/dev', later)
  f.git('checkout', '--detach', f.after)
  assert.equal(f.select().commit, f.after)
  f.git('update-ref', 'refs/remotes/origin/dev', f.before)
  assert.throws(() => f.select(), /reachable/)
})

test('unrelated and unchanged-version merges skip; decreases fail', t => {
  assert.equal(history(t, { version: '1.0.1' }).select().eligible, false)
  assert.equal(history(t, { version: '1.0.1', extensionChange: true }).select().eligible, false)
  assert.throws(() => history(t, { previous: '1.0.3' }).select(), /decreased/)
})

test('complete comparison sees extension changes beyond path-filter limits and intermediate versions', t => {
  const f = history(t)
  for (let index = 0; index < 320; index++) writeFileSync(join(f.root, `unrelated-${index}.txt`), 'fixture')
  writeFileSync(f.manifestPath, JSON.stringify({ name: packageName, version: '1.0.3' }))
  f.git('add', '.'); f.git('commit', '-m', 'Intermediate version')
  writeFileSync(f.manifestPath, JSON.stringify({ name: packageName, version: '1.0.4' }))
  f.git('add', 'apps/extension/package.json'); f.git('commit', '-m', 'Final version')
  const after = f.git('rev-parse', 'HEAD')
  f.git('update-ref', 'refs/remotes/origin/dev', after)
  const selected = f.select('dev', { after }, { GITHUB_SHA: after })
  assert.equal(selected.baseVersion, '1.0.4')
  assert.equal(selected.commit, after)
})

test('actual detect command emits successful skip/eligibility outputs and checks merged PR before selecting a build', t => {
  for (const version of ['1.0.1', '1.0.2']) {
    const f = history(t, { version })
    f.select()
    mkdirSync(join(f.root, 'tooling'))
    for (const name of ['extension-release.mjs', 'cli-release.mjs', 'pnpm-command.mjs']) copyFileSync(new URL(name, import.meta.url), join(f.root, 'tooling', name))
    const preload = join(f.root, 'network.mjs')
    const output = join(f.root, 'output')
    writeFileSync(preload, `globalThis.fetch=async()=>{ if(process.env.EXPECT_SKIP)throw Error('Unexpected API request');return new Response(JSON.stringify([{number:42,merged_at:'2026-10-15',merge_commit_sha:${JSON.stringify(f.after)},base:{ref:'dev',repo:{full_name:${JSON.stringify(repository)}}}}])) }`)
    const result = spawnSync(process.execPath, ['--import', preload, join(f.root, 'tooling/extension-release.mjs'), 'detect'], { cwd: f.root, env: { ...process.env, ...f.env, GH_TOKEN: 'synthetic-fixture-token', GITHUB_OUTPUT: output, EXPECT_SKIP: version === '1.0.1' ? '1' : '' }, encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).eligible, version === '1.0.2')
    assert.equal(readFileSync(output, 'utf8'), `eligible=${version === '1.0.2'}\n`)
  }
})

test('event and source identity fail closed before packaging', t => {
  const f = history(t)
  for (const changes of [{ forced: true }, { created: true }, { deleted: true }, { before: '0'.repeat(40) }, { before: 'f'.repeat(40) }, { after: f.before }, { repository: { full_name: 'other/repo' } }]) assert.throws(() => f.select('dev', changes))
  for (const env of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF_TYPE: 'tag' }, { GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_REF: 'refs/heads/main' }, { GITHUB_SHA: f.before }]) assert.throws(() => f.select('dev', {}, env))
  assert.throws(() => f.select('feature/task'))
  const original = readFileSync(f.manifestPath, 'utf8')
  writeFileSync(f.manifestPath, JSON.stringify({ name: packageName, version: '9.0.0' }))
  assert.throws(() => f.select(), /differs/)
  writeFileSync(f.manifestPath, original)
  f.git('checkout', '--orphan', 'unrelated')
  f.git('rm', '-rf', '.')
  writeFileSync(join(f.root, 'parallel.txt'), 'parallel')
  f.git('add', '.'); f.git('commit', '-m', 'Unrelated history')
  const parallel = f.git('rev-parse', 'HEAD')
  f.git('checkout', '--detach', f.after)
  assert.throws(() => f.select('dev', { before: parallel }), /preserve branch history/)
})
