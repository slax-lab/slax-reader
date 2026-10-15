import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changedPaths, selectScopes } from './ci-scope.mjs'

const appNames = ['web', 'extension', 'api', 'mobile', 'cli']
const selectedApps = paths => appNames.filter(name => selectScopes(paths).scopes[name])

test('application and shared package consumers are independent', () => {
  for (const app of appNames) assert.deepEqual(selectedApps([`apps/${app}/src/example.ts`]), [app])
  assert.deepEqual(selectedApps(['packages/contracts/src/api.ts']), appNames)
  assert.deepEqual(selectedApps(['packages/new-shared-package/src/index.ts']), appNames)
  for (const pkg of ['frontend-types', 'frontend-utils', 'selection']) assert.deepEqual(selectedApps([`packages/${pkg}/src/index.ts`]), ['web', 'extension'])
  for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc']) assert.deepEqual(selectedApps([path]), appNames)
  assert.deepEqual(selectedApps(['apps/web/page.vue', 'apps/cli/index.ts']), ['web', 'cli'])
})

test('dispatchers select actual consumers and release tooling never selects frontend', () => {
  for (const app of appNames) assert.deepEqual(selectedApps([`tooling/${app}.mjs`]), [app])
  for (const path of ['tooling/run-app.mjs', 'tooling/env-files.mjs', 'tooling/env-files.d.mts']) assert.deepEqual(selectedApps([path]), ['web', 'extension'])
  assert.deepEqual(selectedApps(['tooling/pnpm-command.mjs']), appNames)
  for (const path of ['tooling/cli-release.mjs', 'tooling/cli-release.test.mjs', '.github/workflows/cli-release.yml']) {
    assert.deepEqual(selectedApps([path]), [])
    assert.equal(selectScopes([path]).scopes.cliTooling, true)
  }
})

test('deployment input ownership and prose do not spill into unrelated apps', () => {
  assert.deepEqual(selectedApps(['deploy/mobile/tooling.cjs']), ['mobile'])
  assert.deepEqual(selectedApps(['deploy/mobile/README.md']), [])
  assert.deepEqual(selectedApps(['deploy/mobile/README-helper.cjs']), ['mobile'])
  assert.deepEqual(selectedApps(['apps/mobile/README.ts']), ['mobile'])
  assert.deepEqual(selectedApps(['apps/cli/AGENTS.md']), [])
  assert.deepEqual(selectedApps(['deploy/local/dockerfile-local-pgsql.yaml']), ['api'])
  assert.deepEqual(selectedApps(['deploy/local/.env.web.example']), ['web'])
  assert.deepEqual(selectedApps(['deploy/local/.env.extension.example']), ['extension'])
  assert.deepEqual(selectedApps(['deploy/cloudflare/api.toml.example']), ['api'])
  for (const path of ['docs/mobile/README.md', 'docs/mobile/release.md', 'docs/LOCAL-SETUP.md']) assert.deepEqual(selectedApps([path]), [])
  assert.equal(selectScopes(['docs/mobile/evidence/report.md']).scopes.mobileEvidence, true)
  assert.equal(selectScopes(['docs/mobile/source-manifest.json']).scopes.mobileEvidence, true)
  assert.equal(selectScopes(['docs/mobile/README.md']).scopes.mobileEvidence, false)
  assert.equal(selectScopes(['apps/web/content/article.md']).scopes.web, true)
})

test('Extension release fixtures retain coverage without selecting unrelated application suites', () => {
  for (const path of ['tooling/extension-release.mjs', 'tooling/extension-release-archive.py', 'tooling/extension-release.test.mjs', '.github/workflows/extension-release.yml']) {
    assert.deepEqual(selectedApps([path]), [])
    assert.equal(selectScopes([path]).scopes.extensionTooling, true)
  }
  for (const path of ['apps/extension/wxt.config.ts', 'tooling/pnpm-command.mjs', 'tooling/cli-release.mjs', 'tooling/extension.mjs', 'tooling/run-app.mjs', 'tooling/env-files.mjs', '.github/workflows/tooling-ci.yml']) assert.equal(selectScopes([path]).scopes.extensionTooling, true)
  for (const path of ['apps/web/page.vue', 'apps/extension/AGENTS.md', 'tooling/cli-release.test.mjs']) assert.equal(selectScopes([path]).scopes.extensionTooling, false)
})

test('design, icons and configuration guards retain their exact validation inputs', () => {
  for (const path of ['DESIGN.md', 'docs/design/reference/example.svg', 'tooling/design-reference.mjs']) assert.equal(selectScopes([path]).scopes.design, true)
  assert.equal(selectScopes(['docs/design/reference/example.svg']).scopes.icons, true)
  for (const path of ['apps/web/app/icons/registry.json', 'apps/web/app/icons/registry.generated.ts']) assert.equal(selectScopes([path]).scopes.icons, true)
  for (const path of ['.rulesync/rules/overview.md', 'apps/web/AGENTS.md', '.agents/skills/example/SKILL.md', 'rulesync.jsonc']) assert.equal(selectScopes([path]).scopes.rulesync, true)
  assert.equal(selectScopes(['openspec/changes/example/tasks.md']).scopes.openspec, true)
  for (const path of ['.github/workflows/pr-review.md', '.github/workflows/shared/pr-review-core.md', '.github/workflows/pr-review.lock.yml', '.github/aw/actions-lock.json', '.github/workflows/aw.json', 'tooling/check-gh-aw-drift.sh']) assert.equal(selectScopes([path]).scopes.ghAw, true)
  const plain = selectScopes(['apps/web/app/pages/index.vue']).scopes
  for (const guard of ['rulesync', 'openspec', 'ghAw']) assert.equal(plain[guard], false)
  for (const input of ['tooling/ci-scope.mjs', '.github/actions/ci-scope/action.yml']) assert.ok(Object.values(selectScopes([input]).scopes).every(Boolean))
})

test('policy rejects unsafe paths and emits deterministic selection reasons', () => {
  for (const path of ['', '/absolute', 'apps/../other', 'bad\0file']) assert.throws(() => selectScopes([path]))
  const result = selectScopes(['apps/web/a b.vue', 'apps/web/a b.vue'])
  assert.deepEqual(result.reasons.web, ['apps/web/a b.vue'])
})

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'ci-scope-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test'); git('config', 'commit.gpgsign', 'false')
  const put = (path, contents = 'fixture') => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), contents) }
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD') }
  return { cwd, git, put, commit }
}

test('complete merge-base comparison retains earlier PR commits and destination branch differences', t => {
  const f = fixture(t)
  f.put('initial'); const base = f.commit()
  f.git('branch', 'beta')
  f.put('apps/web/first.vue'); f.commit()
  f.put('apps/cli/last.ts'); const head = f.commit()
  assert.deepEqual(selectedApps(changedPaths({ cwd: f.cwd, base, head })), ['web', 'cli'])
  f.git('checkout', '-q', 'beta'); f.put('apps/api/target-only.ts'); const target = f.commit()
  assert.deepEqual(selectedApps(changedPaths({ cwd: f.cwd, base: target, head })), ['web', 'cli'])
})

test('renames, deletions, spaced names and changes beyond 300 files retain all scopes', t => {
  const f = fixture(t)
  f.put('apps/web/old name.vue'); const base = f.commit()
  f.git('rm', 'apps/web/old name.vue'); f.put('apps/extension/new name.ts')
  for (let i = 0; i < 350; i++) f.put(`docs/guide-${i}.md`)
  f.put('apps/mobile/z-last.ts'); const head = f.commit()
  const paths = changedPaths({ cwd: f.cwd, base, head })
  assert.equal(paths.length, 353)
  assert.ok(paths.includes('apps/web/old name.vue'))
  assert.deepEqual(selectedApps(paths), ['web', 'extension', 'mobile'])
})

test('unavailable and malformed revisions fail rather than produce an empty success', t => {
  const f = fixture(t); f.put('initial'); const head = f.commit()
  for (const base of ['HEAD', '--help', '0'.repeat(40), 'a'.repeat(40)]) assert.throws(() => changedPaths({ cwd: f.cwd, base, head }))
  const event = join(f.cwd, 'event.json'), output = join(f.cwd, 'output')
  writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: 'a'.repeat(40) }, head: { sha: head } } }))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-scope.mjs', import.meta.url))], { cwd: f.cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output } })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
})

test('shallow history cannot masquerade as a complete PR comparison', t => {
  const f = fixture(t); f.put('initial'); const base = f.commit()
  f.put('apps/cli/index.ts'); const head = f.commit()
  f.git('clone', '--depth=1', `file://${f.cwd}`, join(f.cwd, 'shallow'))
  assert.throws(() => changedPaths({ cwd: join(f.cwd, 'shallow'), base: head, head }), /complete Git history/)
  assert.throws(() => changedPaths({ cwd: join(f.cwd, 'shallow'), base, head }))
})
