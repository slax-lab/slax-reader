import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { releaseNotes } from './cli-release.mjs'

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'cli-notes-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-q', '-b', 'dev'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test'); git('config', 'commit.gpgsign', 'false')
  const commit = (files, message = 'fixture') => {
    for (const [path, contents] of Object.entries(files)) { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), contents) }
    git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD')
  }
  const candidate = (channel = 'dev', baseVersion = '4.0.0') => ({ channel, baseVersion, version: channel === 'stable' ? baseVersion : `${baseVersion}-${channel}`, commit: git('rev-parse', 'HEAD') })
  return { cwd, git, commit, candidate }
}

test('CLI notes exclude other applications and mixed subjects while retaining actual shared inputs', t => {
  const f = fixture(t)
  f.commit({ 'apps/cli/package.json': '1.0.0' }); f.git('tag', 'cli-v1.0.0')
  const cli = f.commit({ 'apps/cli/src/command.ts': 'new command' }, 'feat(cli): new command')
  const web = f.commit({ 'apps/web/page.vue': 'web' }, 'feat(web): mobile onboarding')
  f.commit({ 'apps/mobile/app.ts': 'mobile' }, 'feat(mobile): migrate reader')
  f.commit({ 'packages/contracts/api.ts': 'shared', 'apps/web/consumer.ts': 'web consumer' }, 'feat(web): unrelated mixed title')
  f.commit({ 'tooling/cli-release.mjs': 'tool', 'pnpm-lock.yaml': 'web dependency' })
  const result = releaseNotes(f.candidate(), f.cwd)
  assert.equal(result.baseline.tag, 'cli-v1.0.0')
  assert.match(result.body, /apps\/cli\/src\/command.ts/)
  assert.match(result.body, /Shared CLI contracts/)
  assert.match(result.body, /packages\/contracts\/api.ts/)
  assert.match(result.body, new RegExp(cli))
  assert.doesNotMatch(result.body, /apps\/web|apps\/mobile|feat\(web\)|feat\(mobile\)|pnpm-lock|Full Changelog/)
  assert.ok(!result.body.includes(web))
  assert.deepEqual(releaseNotes(f.candidate(), f.cwd), result)
})

test('same channel takes precedence, first preview falls back to stable, and current tags are excluded', t => {
  const f = fixture(t)
  f.commit({ 'apps/cli/package.json': '1' }); f.git('tag', 'cli-v1.0.0-beta')
  f.commit({ 'apps/cli/package.json': '2' }); f.git('tag', 'cli-v2.0.0')
  f.commit({ 'apps/cli/package.json': '3' }); f.git('tag', 'mobile-v99.0.0')
  const beta = f.candidate('beta'), dev = f.candidate(), stable = f.candidate('stable')
  f.git('tag', 'cli-v4.0.0-beta')
  assert.equal(releaseNotes(beta, f.cwd).baseline.tag, 'cli-v1.0.0-beta')
  assert.equal(releaseNotes(dev, f.cwd).baseline.tag, 'cli-v2.0.0')
  assert.equal(releaseNotes(stable, f.cwd).baseline.tag, 'cli-v2.0.0')
  assert.match(releaseNotes(dev, f.cwd).body, /CLI package version updated to 4.0.0-dev/)
})

test('highest lower ancestor version wins over tag names and unrelated ancestry', t => {
  const f = fixture(t)
  const root = f.commit({ 'apps/cli/package.json': '1' }); f.git('tag', 'cli-v1.0.0-dev')
  f.commit({ 'apps/cli/package.json': '2' }); f.git('tag', '-a', 'cli-v2.0.0-dev', '-m', 'annotated fixture')
  f.commit({ 'apps/cli/package.json': 'candidate' }); const candidate = f.candidate()
  f.git('checkout', '-q', '-b', 'unrelated', root)
  f.commit({ 'apps/cli/package.json': 'unrelated' }); f.git('tag', 'cli-v3.0.0-dev')
  f.git('checkout', '-q', 'dev')
  const result = releaseNotes(candidate, f.cwd)
  assert.equal(result.baseline.tag, 'cli-v2.0.0-dev')
  assert.deepEqual(releaseNotes(candidate, f.cwd, result.baseline), result)
  assert.throws(() => releaseNotes(candidate, f.cwd, { tag: 'cli-v2.0.0-dev', commit: root }), /identity changed/)
})

test('first release reports CLI history and promotion merge summaries do not leak', t => {
  const f = fixture(t)
  f.commit({ 'initial.txt': 'initial' }); f.git('branch', 'main')
  f.commit({ 'apps/cli/src/first.ts': 'CLI', 'apps/mobile/app.ts': 'mobile' }, 'Mobile and CLI migration')
  f.git('checkout', '-q', 'main'); f.commit({ 'apps/web/page.vue': 'web' })
  f.git('merge', '--no-ff', '-qm', 'Promote every app in the repository', 'dev')
  const result = releaseNotes(f.candidate('stable'), f.cwd)
  assert.equal(result.baseline, null)
  assert.match(result.body, /First release/)
  assert.match(result.body, /apps\/cli\/src\/first.ts/)
  assert.doesNotMatch(result.body, /Promote every app|Mobile and CLI migration|apps\/mobile|apps\/web/)
})

test('CLI changes introduced only by merge resolution appear without the merge subject', t => {
  const f = fixture(t)
  f.commit({ 'apps/cli/src/shared.ts': 'initial' }); f.git('tag', 'cli-v1.0.0'); f.git('branch', 'feature')
  f.commit({ 'apps/cli/src/shared.ts': 'dev' })
  f.git('checkout', '-q', 'feature'); f.commit({ 'feature.txt': 'feature' })
  f.git('checkout', '-q', 'dev')
  f.git('merge', '--no-commit', '--no-ff', 'feature')
  const sha = f.commit({ 'apps/cli/src/merge-only.ts': 'resolution' }, 'Merge unrelated feature')
  const result = releaseNotes(f.candidate(), f.cwd)
  assert.match(result.body, /merge-only.ts/)
  assert.match(result.body, new RegExp(sha))
  assert.doesNotMatch(result.body, /Merge unrelated feature/)
})

test('missing comparison objects and malformed fixed baselines fail instead of generating broad notes', t => {
  const f = fixture(t); f.commit({ 'apps/cli/package.json': 'first' })
  assert.throws(() => releaseNotes({ ...f.candidate(), commit: 'a'.repeat(40) }, f.cwd))
  for (const baseline of [{ tag: '--help', commit: 'a'.repeat(40) }, { tag: 'cli-v1.0.0', commit: 'HEAD' }, { tag: 'cli-v4.0.0', commit: f.candidate().commit }]) assert.throws(() => releaseNotes(f.candidate(), f.cwd, baseline))
})

test('first-release discovery retains CLI tooling globs and rejects malformed source identity', t => {
  const f = fixture(t)
  f.commit({ 'tooling/cli-release.mjs': 'CLI', 'tooling/api.mjs': 'API', '.github/workflows/cli-release.yml': 'CLI workflow' })
  const notes = releaseNotes(f.candidate(), f.cwd)
  assert.match(notes.body, /tooling\/cli-release.mjs/)
  assert.match(notes.body, /\.github\/workflows\/cli-release.yml/)
  assert.doesNotMatch(notes.body, /tooling\/api/)
  for (const values of [{ commit: 'HEAD' }, { channel: 'unknown' }, { version: 'mismatched' }]) assert.throws(() => releaseNotes({ ...f.candidate(), ...values }, f.cwd))
})
