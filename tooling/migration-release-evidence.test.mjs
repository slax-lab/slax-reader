import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  apiDeployWorkflow,
  assessDiff,
  EvidenceError,
  evaluateRelease,
  migrationStepName,
  parseDeclaration,
  parseDiff,
  runCli
} from './migration-release-evidence.mjs'

const repository = 'slax-lab/slax-reader'
const token = 'fixture-token'
const migrationPath = 'apps/api/prisma/pg_migrations/20261028000000_drop_key/migration.sql'
const otherMigration = 'apps/api/prisma/logs_migrations/20261028000001_add_log/migration.sql'
const lockPath = 'apps/api/prisma/pg_migrations/migration_lock.toml'
const fail = message => { throw new Error(message) }

const expand = '-- migration-safety: expand\nALTER TABLE "example" ADD COLUMN "note" text;\n'
const migrate = '-- migration-safety: migrate\n-- preserves: example.id\n-- reason: Backfills before the next release.\nUPDATE "example" SET "note" = \'\';\n'

function contractSource({ prerequisitePr = 42, prerequisiteMerge = 'a'.repeat(40), change = 'example-removal-change', confirmedBy = '@DGuang21' } = {}) {
  return [
    '-- migration-safety: contract',
    '-- removes: example_unique_key',
    `-- prerequisite-change: ${change}`,
    `-- prerequisite-pr: ${prerequisitePr}`,
    `-- prerequisite-merge: ${prerequisiteMerge}`,
    `-- confirmed-by: ${confirmedBy}`,
    '-- reason: The prerequisite release removed the last reader and writer.',
    'DROP INDEX IF EXISTS "example_unique_key";',
    ''
  ].join('\n')
}

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'migration-evidence-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.test')
  git('config', 'commit.gpgsign', 'false')
  git('branch', '-M', 'dev')
  const put = (path, contents = 'fixture') => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), contents) }
  const commit = message => { git('add', '.'); git('commit', '-qm', message ?? 'fixture', '--allow-empty'); return git('rev-parse', 'HEAD') }
  const remove = path => { git('rm', '-q', path) }
  return { cwd, git, put, commit, remove }
}

const gitAdapter = cwd => args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
const response = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function routed(routes) {
  return async url => {
    for (const [pattern, handler] of routes) if (pattern.test(url)) return handler(url)
    throw new Error(`Unexpected GitHub request: ${url}`)
  }
}

function deploymentRoutes({ deployed, environments = ['beta'], status = 'success', runPath = apiDeployWorkflow, runConclusion = 'success', stepConclusion = 'success', records } = {}) {
  const deploymentRecords = records ?? environments.map((environment, index) => ({ id: 10 + index, environment, sha: deployed, created_at: '2026-10-28T05:53:32Z' }))
  return [
    [/\/deployments\?sha=[a-f0-9]{40}&per_page=100$/, () => response(deploymentRecords)],
    [/\/deployments\/\d+\/statuses\?per_page=100$/, () => response([{ state: status, created_at: '2026-10-28T05:56:10Z', log_url: `https://github.com/${repository}/actions/runs/9001/job/1` }])],
    [/\/actions\/runs\/9001$/, () => response({ path: runPath, head_sha: deployed, status: runConclusion === 'in_progress' ? 'in_progress' : 'completed', conclusion: runConclusion === 'in_progress' ? null : runConclusion })],
    [/\/actions\/runs\/9001\/jobs\?per_page=100$/, () => response({ jobs: [{ name: 'deploy', steps: [{ name: migrationStepName, status: 'completed', conclusion: stepConclusion }] }] })]
  ]
}

function prerequisiteRoute({ mergeCommit, body = 'OpenSpec: example-removal-change', merged = true, base = 'dev', head = 'feature/example' } = {}) {
  return [/\/pulls\/42$/, () => response({ merged_at: merged ? '2026-10-27T00:00:00Z' : null, merge_commit_sha: mergeCommit, body, base: { ref: base }, head: { ref: head } })]
}

// routes is either an array or a function receiving the commits the fixture
// created, so a fixture can reference the real SHAs in its API responses.
async function contractRelease(t, { declaration = {}, routes } = {}) {
  const f = fixture(t)
  f.put('README.md', 'fixture')
  const base = f.commit('base')
  f.put('apps/api/src/example.ts', 'export const example = 1\n')
  const prerequisiteMerge = f.commit('prerequisite change')
  f.put('apps/api/src/deployed.ts', 'export const deployed = 1\n')
  const deployed = f.commit('deployed')
  f.put(migrationPath, contractSource({ prerequisiteMerge: deployed, ...declaration }))
  const head = f.commit('migration')
  const selected = typeof routes === 'function' ? routes({ prerequisiteMerge, deployed }) : routes
  const fetchImpl = routed(selected ?? [prerequisiteRoute({ mergeCommit: prerequisiteMerge }), ...deploymentRoutes({ deployed })])
  const run = () => evaluateRelease({ target: 'beta', sourceBranch: 'dev', base, head, repository, token, fetchImpl, git: gitAdapter(f.cwd) })
  return { f, base, head, prerequisiteMerge, deployed, fetchImpl, run }
}

test('a declaration parses one class with exactly the fields that class requires', () => {
  assert.equal(parseDeclaration(expand).cls, 'expand')
  assert.deepEqual(parseDeclaration(migrate).fields, { preserves: 'example.id', reason: 'Backfills before the next release.' })
  const contract = parseDeclaration(contractSource())
  assert.equal(contract.cls, 'contract')
  assert.equal(contract.fields['prerequisite-pr'], '42')
  assert.equal(contract.fields['confirmed-by'], '@DGuang21')
})

test('a declaration ignores ordinary comments and tolerates blank lines and CRLF', () => {
  const source = '-- This migration was reviewed.\r\n\r\n-- migration-safety: expand\r\nALTER TABLE "example" ADD COLUMN "note" text;\r\n'
  assert.equal(parseDeclaration(source).cls, 'expand')
})

test('a declaration fails on a missing class, a missing field, a duplicate and an inapplicable field', () => {
  assert.throws(() => parseDeclaration('ALTER TABLE "example" ADD COLUMN "note" text;'), /no "migration-safety" class line/)
  assert.throws(() => parseDeclaration('-- migration-safety: migrate\n-- reason: only a reason\n'), /preserves/)
  assert.throws(() => parseDeclaration('-- migration-safety: contract\n-- removes: a\n-- removes: b\n'), /duplicate/)
  assert.throws(() => parseDeclaration('-- migration-safety: expand\n-- removes: a\n'), /does not belong/)
  assert.throws(() => parseDeclaration('-- migration-safety: expand\n-- migration-safety: migrate\n'), /more than one/)
  assert.throws(() => parseDeclaration('-- migration-safety: destructive\n'), /unknown migration class/)
})

test('a declaration fails on an unknown safety field and on bad field shapes', () => {
  const unknown = ['-- migration-safety: contract', '-- removes: a', '-- prerequisite-pr: 1', `-- prerequisite-merge: ${'a'.repeat(40)}`, '-- confirmed-by: @a', '-- reason: r', '-- prerequisite-bogus: x', ''].join('\n')
  assert.throws(() => parseDeclaration(unknown), /unknown safety field/)
  assert.throws(() => parseDeclaration(contractSource({ prerequisitePr: 0 })), /invalid shape/)
  assert.throws(() => parseDeclaration(contractSource({ prerequisiteMerge: 'abc' })), /invalid shape/)
  assert.throws(() => parseDeclaration(contractSource({ confirmedBy: 'DGuang21' })), /invalid shape/)
  assert.throws(() => parseDeclaration(contractSource({ change: 'not a change' })), /invalid shape/)
  assert.throws(() => parseDeclaration('-- migration-safety: migrate\n-- preserves: , ,\n-- reason: r\n'), /invalid shape/)
})

test('the release diff is read as NUL-separated name-status pairs', () => {
  assert.deepEqual(parseDiff('A\0a/b.sql\0M\0c/d.sql\0'), [{ status: 'A', path: 'a/b.sql' }, { status: 'M', path: 'c/d.sql' }])
})

test('only added migration files are accepted; everything else fails on immutability', () => {
  const readHeadFile = path => path === migrationPath ? expand : fail(`unexpected read ${path}`)
  assert.deepEqual(assessDiff({ entries: [{ status: 'A', path: migrationPath }], readHeadFile }).map(item => item.path), [migrationPath])
  assert.throws(() => assessDiff({ entries: [{ status: 'M', path: migrationPath }], readHeadFile }), /must not modify/)
  assert.throws(() => assessDiff({ entries: [{ status: 'D', path: migrationPath }], readHeadFile }), /must not delete or rename/)
  assert.throws(() => assessDiff({ entries: [{ status: 'A', path: lockPath }], readHeadFile }), /migration_lock\.toml/)
  assert.deepEqual(assessDiff({ entries: [{ status: 'A', path: 'docs/readme.md' }], readHeadFile: () => fail('must not read') }), [])
})

test('a synthetic release adds a declared migration and touches no API without a contract', async t => {
  const f = fixture(t)
  f.put('README.md', 'fixture'); const base = f.commit('base')
  f.put(migrationPath, expand); const head = f.commit('migration')
  const never = async url => fail(`must not call the API: ${url}`)
  const result = await evaluateRelease({ target: 'dev', sourceBranch: 'dev', base, head, repository, token, fetchImpl: never, git: gitAdapter(f.cwd) })
  assert.deepEqual(result, { migrations: 1, contracts: 0, environments: [] })
})

test('a synthetic release fails when an added migration has no declaration', async t => {
  const f = fixture(t)
  f.put('README.md', 'fixture'); const base = f.commit('base')
  f.put(migrationPath, 'ALTER TABLE "example" ADD COLUMN "note" text;\n'); const head = f.commit('migration')
  await assert.rejects(evaluateRelease({ target: 'dev', sourceBranch: 'dev', base, head, repository, token, fetchImpl: async () => fail('no API'), git: gitAdapter(f.cwd) }), error => error instanceof EvidenceError && error.stage === 'declaration')
})

test('a synthetic release fails when an existing migration is modified or deleted', async t => {
  const f = fixture(t)
  f.put(migrationPath, expand); const base = f.commit('base')
  f.put(migrationPath, migrate); const modified = f.commit('modified')
  await assert.rejects(evaluateRelease({ target: 'dev', sourceBranch: 'dev', base, head: modified, repository, token, fetchImpl: async () => fail('no API'), git: gitAdapter(f.cwd) }), /must not modify/)
  f.remove(migrationPath); const deleted = f.commit('deleted')
  await assert.rejects(evaluateRelease({ target: 'dev', sourceBranch: 'dev', base, head: deleted, repository, token, fetchImpl: async () => fail('no API'), git: gitAdapter(f.cwd) }), /must not delete or rename/)
})

test('a synthetic release fails when a migration is renamed', async t => {
  const f = fixture(t)
  f.put(migrationPath, expand); const base = f.commit('base')
  const renamed = 'apps/api/prisma/pg_migrations/20261028000009_drop_key/migration.sql'
  mkdirSync(dirname(join(f.cwd, renamed)), { recursive: true })
  f.git('mv', migrationPath, renamed); const head = f.commit('renamed')
  await assert.rejects(evaluateRelease({ target: 'dev', sourceBranch: 'dev', base, head, repository, token, fetchImpl: async () => fail('no API'), git: gitAdapter(f.cwd) }), /must not delete or rename/)
})

test('a three-dot promotion diff does not treat a target-only migration as a deletion', async t => {
  const f = fixture(t)
  f.put('README.md', 'fixture'); const base = f.commit('base')
  f.git('branch', 'beta')
  f.put(migrationPath, expand); const head = f.commit('dev migration')
  f.git('checkout', '-q', 'beta')
  f.put(otherMigration, expand); f.commit('beta migration')
  f.git('checkout', '-q', 'dev')
  const result = await evaluateRelease({ target: 'dev', sourceBranch: 'dev', base: 'beta', head, repository, token, fetchImpl: async () => fail('no API'), git: gitAdapter(f.cwd) })
  assert.equal(result.migrations, 1)
})

test('a hotfix may add only expand migrations', async t => {
  const f = fixture(t)
  f.put('README.md', 'fixture'); const base = f.commit('base')
  f.put(migrationPath, expand); const expandHead = f.commit('expand')
  const git = gitAdapter(f.cwd)
  await evaluateRelease({ target: 'beta', sourceBranch: 'hotfix/urgent', base, head: expandHead, repository, token, fetchImpl: async () => fail('no API'), git })
  f.put(otherMigration, migrate); const migrateHead = f.commit('migrate')
  await assert.rejects(evaluateRelease({ target: 'beta', sourceBranch: 'hotfix/urgent', base, head: migrateHead, repository, token, fetchImpl: async () => fail('no API'), git }), error => error.stage === 'hotfix')
})

test('a valid contract passes with one direct deployments read', async t => {
  const { run } = await contractRelease(t)
  const result = await run()
  assert.equal(result.contracts, 1)
  assert.deepEqual(result.environments, ['beta'])
})

test('a contract fails closed when the prerequisite pull request is not merged', async t => {
  await contractRelease(t, { routes: ({ prerequisiteMerge }) => [prerequisiteRoute({ mergeCommit: prerequisiteMerge, merged: false })] })
    .then(release => assert.rejects(release.run(), error => error.stage === 'prerequisite' && /not a merged pull request/.test(error.message)))
})

test('a contract requires the prerequisite merge commit to be an ancestor of the declared commit', async t => {
  const f = fixture(t)
  f.put('README.md', 'fixture'); const base = f.commit('base')
  f.put('apps/api/src/deployed.ts', 'export const deployed = 1\n'); const deployed = f.commit('deployed')
  f.put('apps/api/src/other.ts', 'export const other = 1\n'); const prerequisiteMerge = f.commit('later change')
  f.put(migrationPath, contractSource({ prerequisiteMerge: deployed })); const head = f.commit('migration')
  const fetchImpl = routed([prerequisiteRoute({ mergeCommit: prerequisiteMerge })])
  await assert.rejects(evaluateRelease({ target: 'beta', sourceBranch: 'dev', base, head, repository, token, fetchImpl, git: gitAdapter(f.cwd) }), error => error.stage === 'prerequisite' && /not an ancestor/.test(error.message))
})

test('a contract requires the declared commit to be an ancestor of the release head', async t => {
  const f = fixture(t)
  f.put('README.md', 'fixture'); const base = f.commit('base')
  f.put('apps/api/src/prerequisite.ts', 'export const p = 1\n'); const prerequisiteMerge = f.commit('prerequisite')
  f.git('checkout', '-q', '-b', 'side')
  f.put('apps/api/src/side.ts', 'export const side = 1\n'); const declared = f.commit('side')
  f.git('checkout', '-q', 'dev')
  f.put(migrationPath, contractSource({ prerequisiteMerge: declared })); const head = f.commit('migration')
  const fetchImpl = routed([prerequisiteRoute({ mergeCommit: prerequisiteMerge })])
  await assert.rejects(evaluateRelease({ target: 'beta', sourceBranch: 'dev', base, head, repository, token, fetchImpl, git: gitAdapter(f.cwd) }), error => error.stage === 'prerequisite' && /not an ancestor of the release head/.test(error.message))
})

test('a contract checks the OpenSpec trailer and allows the implementation-only n/a pair', async t => {
  const mismatch = await contractRelease(t, {
    routes: ({ prerequisiteMerge, deployed }) => [prerequisiteRoute({ mergeCommit: prerequisiteMerge, body: 'OpenSpec: another-change' }), ...deploymentRoutes({ deployed })]
  })
  await assert.rejects(mismatch.run(), error => error.stage === 'prerequisite' && /OpenSpec/.test(error.message))
  const nA = await contractRelease(t, {
    declaration: { change: 'n/a' },
    routes: ({ prerequisiteMerge, deployed }) => [prerequisiteRoute({ mergeCommit: prerequisiteMerge, body: 'OpenSpec: n/a' }), ...deploymentRoutes({ deployed })]
  })
  const result = await nA.run()
  assert.equal(result.contracts, 1)
})

test('a contract fails closed with the human-review path when no deployment record exists', async t => {
  const { run } = await contractRelease(t, {
    routes: ({ prerequisiteMerge }) => [prerequisiteRoute({ mergeCommit: prerequisiteMerge }), [/\/deployments\?sha=/, () => response([])]]
  })
  await assert.rejects(run(), error => error.stage === 'evidence' && /human-review path/i.test(error.message))
})

test('web-deploy and dev-only records are not evidence', async t => {
  const webOnly = await contractRelease(t, {
    routes: ({ prerequisiteMerge, deployed }) => [prerequisiteRoute({ mergeCommit: prerequisiteMerge }), ...deploymentRoutes({ deployed, runPath: '.github/workflows/web-deploy.yml' })]
  })
  await assert.rejects(webOnly.run(), error => error.stage === 'evidence' && /not an api-deploy deployment/.test(error.message))
  const devOnly = await contractRelease(t, {
    routes: ({ prerequisiteMerge, deployed }) => [prerequisiteRoute({ mergeCommit: prerequisiteMerge }), [/\/deployments\?sha=/, () => response([{ id: 1, environment: 'dev', sha: deployed, created_at: '2026-10-28T05:53:32Z' }])]]
  })
  await assert.rejects(devOnly.run(), error => error.stage === 'evidence' && /human-review path/i.test(error.message))
})

test('a failed status, an in-progress run and a failed migration step fail closed', async t => {
  for (const [name, overrides, expected] of [
    ['failed status', { status: 'failure' }, /is failure/],
    ['in-progress status', { status: 'in_progress' }, /is in_progress/],
    ['failed run', { runConclusion: 'failure' }, /api-deploy run/],
    ['failed step', { stepConclusion: 'failure' }, /concluded failure/]
  ]) {
    const release = await contractRelease(t, {
      routes: ({ prerequisiteMerge, deployed }) => [prerequisiteRoute({ mergeCommit: prerequisiteMerge }), ...deploymentRoutes({ deployed, ...overrides })]
    })
    await assert.rejects(release.run(), error => error.stage === 'evidence' && expected.test(error.message), name)
  }
})

test('the newest record per environment decides and a tie with different outcomes is ambiguous', async t => {
  const olderFailure = [
    { id: 1, environment: 'beta', sha: 'fixture', created_at: '2026-10-28T00:00:00Z' },
    { id: 2, environment: 'beta', sha: 'fixture', created_at: '2026-10-28T05:53:32Z' }
  ]
  const newestWins = await contractRelease(t, {
    routes: ({ prerequisiteMerge, deployed }) => [
      prerequisiteRoute({ mergeCommit: prerequisiteMerge }),
      [/\/deployments\?sha=/, () => response(olderFailure.map(record => ({ ...record, sha: deployed })))],
      [/\/deployments\/1\/statuses\?per_page=100$/, () => response([{ state: 'failure', created_at: '2026-10-28T00:01:00Z', log_url: `https://github.com/${repository}/actions/runs/9001/job/1` }])],
      ...deploymentRoutes({ deployed }).slice(1)
    ]
  })
  await newestWins.run()

  const tie = [
    { id: 3, environment: 'beta', sha: 'fixture', created_at: '2026-10-28T05:53:32Z' },
    { id: 4, environment: 'beta', sha: 'fixture', created_at: '2026-10-28T05:53:32Z' }
  ]
  const ambiguous = await contractRelease(t, {
    routes: ({ prerequisiteMerge, deployed }) => [
      prerequisiteRoute({ mergeCommit: prerequisiteMerge }),
      [/\/deployments\?sha=/, () => response(tie.map(record => ({ ...record, sha: deployed })))],
      [/\/deployments\/3\/statuses\?per_page=100$/, () => response([{ state: 'success', created_at: '2026-10-28T05:56:10Z', log_url: `https://github.com/${repository}/actions/runs/9001/job/1` }])],
      [/\/deployments\/4\/statuses\?per_page=100$/, () => response([{ state: 'failure', created_at: '2026-10-28T05:56:10Z', log_url: `https://github.com/${repository}/actions/runs/9001/job/1` }])],
      ...deploymentRoutes({ deployed }).slice(1)
    ]
  })
  await assert.rejects(ambiguous.run(), error => error.stage === 'evidence' && /ambiguous/.test(error.message))
})

test('every environment with a record must pass', async t => {
  const release = await contractRelease(t, {
    routes: ({ prerequisiteMerge, deployed }) => [prerequisiteRoute({ mergeCommit: prerequisiteMerge }), ...deploymentRoutes({ deployed, environments: ['beta', 'main'] })]
  })
  assert.deepEqual((await release.run()).environments, ['beta', 'main'])
})

test('a dev deploy skips prerequisite and deployment evidence', async t => {
  const f = fixture(t)
  f.put('README.md', 'fixture'); const base = f.commit('base')
  f.put(migrationPath, contractSource({ prerequisiteMerge: 'b'.repeat(40) })); const head = f.commit('migration')
  const result = await evaluateRelease({ target: 'dev', sourceBranch: 'dev', base, head, repository, token, fetchImpl: async url => fail(`must not call the API: ${url}`), git: gitAdapter(f.cwd) })
  assert.equal(result.contracts, 0)
})

test('an api error never leaks the raw response body', async t => {
  const f = fixture(t)
  f.put('README.md', 'fixture'); const base = f.commit('base')
  f.put(migrationPath, contractSource({ prerequisiteMerge: 'b'.repeat(40) })); const head = f.commit('migration')
  const fetchImpl = async () => new Response('fixture-private-error', { status: 503 })
  await assert.rejects(
    evaluateRelease({ target: 'beta', sourceBranch: 'dev', base, head, repository, token, fetchImpl, git: gitAdapter(f.cwd) }),
    error => error.stage === 'prerequisite' && !error.message.includes('fixture-private-error') && /HTTP 503/.test(error.message)
  )
})

test('the deploy CLI verifies a contract end to end', async t => {
  const f = fixture(t)
  f.put('README.md', 'fixture'); const base = f.commit('base')
  f.put('apps/api/src/prerequisite.ts', 'export const p = 1\n'); const prerequisiteMerge = f.commit('prerequisite')
  f.put('apps/api/src/deployed.ts', 'export const d = 1\n'); const deployed = f.commit('deployed')
  f.put(migrationPath, contractSource({ prerequisiteMerge: deployed })); f.commit('migration')
  const fetchImpl = routed([prerequisiteRoute({ mergeCommit: prerequisiteMerge }), ...deploymentRoutes({ deployed })])
  const result = await runCli(
    { MRE_MODE: 'deploy', TARGET_BRANCH: 'beta', PR_HEAD_REF: 'dev', GITHUB_REPOSITORY: repository, GH_TOKEN: token },
    { git: gitAdapter(f.cwd), fetchImpl }
  )
  assert.equal(result.contracts, 1)
  assert.deepEqual(result.environments, ['beta'])
})

test('the CLI fails closed on missing configuration and passes a release without contracts', async t => {
  const failures = []
  const missing = await runCli({}, { errorLog: message => failures.push(message) })
  assert.equal(missing.failed, true)
  assert.match(failures[0], /evidence failed/)

  const f = fixture(t)
  f.put('README.md', 'fixture'); f.commit('base')
  f.put(migrationPath, expand); f.commit('migration')
  const result = await runCli(
    { MRE_MODE: 'deploy', TARGET_BRANCH: 'dev', PR_HEAD_REF: 'dev', GITHUB_REPOSITORY: repository, GH_TOKEN: token },
    { git: gitAdapter(f.cwd), fetchImpl: async () => fail('no API') }
  )
  assert.equal(result.migrations, 1)
})
