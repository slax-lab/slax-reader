import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EvidenceError,
  adoptionCommit,
  classifyPath,
  codeownersPattern,
  releaseDiffFromTrees,
  createGithubEvidence,
  latestReviewStates,
  ownersForPath,
  parseCliArgs,
  parseDeclaration,
  parseGitDiff,
  resolveServingCommit,
  runCli,
  stageNames,
  trailerExempt,
  verifyReleaseEvidence
} from './migration-release-evidence.mjs'

const repository = 'slax-lab/slax-reader'
const headSha = 'a'.repeat(40)
const baseSha = 'b'.repeat(40)
const mainTip = 'c'.repeat(40)
const prereqMerge = 'd'.repeat(40)
const prodSha = 'e'.repeat(40)
const betaSha = 'f'.repeat(40)
const ownerBase = '1'.repeat(40)
const introducingPr = 900
const prerequisitePr = 412

const pg = name => `apps/api/prisma/pg_migrations/${name}/migration.sql`
const logs = name => `apps/api/prisma/logs_migrations/${name}/migration.sql`
const d1 = name => `apps/api/prisma/d1_migrations/${name}.sql`
const fulltext = name => `apps/api/prisma/d1_migrations/fulltext/${name}.sql`

const codeownersText = [
  '# Catch-all first, specific rules last.',
  '* @slax-lab/reader-core',
  '/apps/api/** @DGuang21 @slax-lab/reader-core',
  '/apps/api/prisma/** @DGuang21 @boxcounter @slax-lab/reader-core'
].join('\n')

const expandText = '-- migration-safety: expand\nALTER TABLE example ADD COLUMN value integer;\n'
const migrateText = '-- migration-safety: migrate\n-- preserves: example_unique_key\n-- reason: Backfills the renamed column.\nUPDATE example SET value = 0;\n'
const contractText = [
  '-- migration-safety: contract',
  '-- removes: example_unique_key',
  '-- prerequisite-change: example-removal',
  `-- prerequisite-pr: ${prerequisitePr}`,
  `-- prerequisite-merge: ${prereqMerge}`,
  '-- reason: The prerequisite release removed the last reader and writer.',
  'DROP INDEX IF EXISTS "example_unique_key";',
  ''
].join('\n')
const adjudicatedText = [
  '-- migration-safety: adjudicated',
  '-- adjudicated-class: contract',
  '-- removes: example_unique_key',
  '-- incident: https://github.com/slax-lab/slax-reader/issues/123',
  '-- adjudicated-at: 2026-10-28T12:00:00Z',
  '-- approved-by: @DGuang21, @boxcounter',
  '-- backup: R2 snapshot backup-20261028',
  '-- ledger-reconciliation: prisma migrate resolve --applied 20261028_example',
  '-- reason: The prerequisite cannot be deployed first.',
  'DROP INDEX IF EXISTS "example_unique_key";',
  ''
].join('\n')

const review = (login, state, extra = {}) => ({ user: { login }, state, submitted_at: '2026-10-27T00:00:00Z', id: 1, ...extra })
const mergedPull = (overrides = {}) => ({
  number: prerequisitePr,
  merged: true,
  mergeCommitSha: prereqMerge,
  body: 'OpenSpec: example-removal',
  baseRef: 'dev',
  headRef: 'feat/example-removal',
  ...overrides
})

const contentSha = text => createHash('sha1').update(text).digest('hex')

function evidenceFixture(overrides = {}) {
  const calls = []
  const files = overrides.files ?? {}
  const existing = overrides.existing ?? {}
  const pull = overrides.pull ?? mergedPull()
  const targetCommit = overrides.targetCommit ?? '3'.repeat(40)
  return {
    calls,
    evidence: {
      // `existing.target` models the target branch as it stood before the
      // release; other keys are branch names or the adoption commit. Each value
      // is that revision's file content, so identity is compared the way the
      // real surfaces compare blob hashes.
      async fileSha(ref, path) {
        calls.push(['fileSha', ref, path])
        if (ref === 'HEAD') return path in files ? contentSha(files[path]) : null
        const copy = (existing[ref === targetCommit ? 'target' : ref] ?? {})[path]
        return copy === undefined ? null : contentSha(copy)
      },
      async readMigration(path) {
        calls.push(['readMigration', path])
        if (!(path in files)) throw new Error(`no fixture content for ${path}`)
        return files[path]
      },
      async ancestry(ancestor, descendant) {
        calls.push(['ancestry', ancestor, descendant])
        return overrides.ancestry ? overrides.ancestry(ancestor, descendant) : true
      },
      async branchTip(name) {
        calls.push(['branchTip', name])
        return name === 'main' ? mainTip : betaSha
      },
      async introducingPullRequest(path) {
        calls.push(['introducingPullRequest', path])
        if (overrides.introducing) throw overrides.introducing
        return { number: introducingPr, baseSha: ownerBase }
      },
      async codeowners(sha) {
        calls.push(['codeowners', sha])
        return overrides.codeowners ?? codeownersText
      },
      async reviews(number) {
        calls.push(['reviews', number])
        if (overrides.reviews) throw overrides.reviews
        return overrides.approvals ?? [review('DGuang21', 'APPROVED')]
      },
      async pullRequest(number) {
        calls.push(['pullRequest', number])
        return pull
      },
      async currentPullRequest(number) {
        calls.push(['currentPullRequest', number])
        if (!overrides.current) throw new Error(`no fixture current pull request ${number}`)
        return overrides.current
      },
      async servingCommit(environment) {
        calls.push(['servingCommit', environment])
        const value = (overrides.serving ?? {})[environment]
        if (value instanceof Error) throw value
        return value ?? { environment, sha: environment === 'main' ? prodSha : betaSha }
      }
    }
  }
}

async function verify(overrides = {}, options = {}) {
  const targetCommit = options.targetCommit ?? '3'.repeat(40)
  const { evidence, calls } = evidenceFixture({ targetCommit, ...overrides })
  const result = await verifyReleaseEvidence({
    evidence,
    diff: options.diff ?? [],
    headSha: options.headSha ?? headSha,
    headRef: options.headRef ?? 'dev',
    targetRef: options.targetRef ?? 'beta',
    targetCommit,
    currentPullRequest: options.currentPullRequest,
    environment: options.environment ?? 'beta',
    surface: options.surface ?? 'pull-request'
  })
  return { result, calls }
}

const stages = result => result.findings.map(finding => finding.stage)

test('a declaration must be complete, unique, and applicable to its class', () => {
  const expand = parseDeclaration(expandText, d1('0001_init'))
  assert.equal(expand.class, 'expand')
  assert.equal(expand.baseClass, 'expand')

  const migrate = parseDeclaration(migrateText, pg('add_value'))
  assert.equal(migrate.class, 'migrate')
  assert.equal(migrate.fields.get('preserves'), 'example_unique_key')

  const contract = parseDeclaration(contractText, pg('drop_key'))
  assert.equal(contract.class, 'contract')
  assert.equal(contract.fields.get('prerequisite-pr'), String(prerequisitePr))

  const adjudicated = parseDeclaration(adjudicatedText, pg('drop_key_now'))
  assert.equal(adjudicated.class, 'adjudicated')
  assert.equal(adjudicated.baseClass, 'contract')
  assert.deepEqual(adjudicated.approvedBy, ['dguang21', 'boxcounter'])

  assert.throws(() => parseDeclaration('ALTER TABLE t ADD COLUMN c int;\n', d1('0001')), /missing a leading -- migration-safety declaration/)
  assert.throws(() => parseDeclaration('-- migration-safety: expand\n-- reason: because\nSELECT 1;\n', d1('0001')), /"-- reason" does not apply/)
  assert.throws(() => parseDeclaration('-- migration-safety: migrate\n-- preserves: k\n', pg('x')), /missing required field "-- reason"/)
  assert.throws(() => parseDeclaration('-- migration-safety: contract\n-- removes: k\n-- prerequisite-change: c\n-- prerequisite-pr: 1\n-- reason: r\n', pg('x')), /missing required field "-- prerequisite-merge"/)
  assert.throws(() => parseDeclaration('-- migration-safety: contract\n-- removes: k\n-- preserves: k\n-- prerequisite-change: c\n-- prerequisite-pr: 1\n-- prerequisite-merge: ' + prereqMerge + '\n-- reason: r\n', pg('x')), /"-- preserves" does not apply/)
  assert.throws(() => parseDeclaration('-- migration-safety: expand\n-- migration-safety: expand\n', d1('x')), /duplicate migration safety field/)
  assert.throws(() => parseDeclaration('-- migration-safety: expand\n-- prerequisite-approval: @someone\n', d1('x')), /unknown migration safety field/)
  assert.throws(() => parseDeclaration('-- migration-safety: contract\n-- removes: k\n-- prerequisite-change: c\n-- prerequisite-pr: 0\n-- prerequisite-merge: ' + prereqMerge + '\n-- reason: r\n', pg('x')), /"-- prerequisite-pr" has an invalid value/)
  assert.throws(() => parseDeclaration('-- migration-safety: contract\n-- removes: k\n', pg('x')), /does not apply|missing required/)
  assert.throws(() => parseDeclaration('-- migration-safety: adjudicated\n-- adjudicated-class: contract\n-- removes: k\n-- incident: i\n-- adjudicated-at: 2026-10-28T12:00:00Z\n-- approved-by: @DGuang21\n-- backup: b\n-- ledger-reconciliation: l\n-- reason: r\n', pg('x')), /"-- approved-by" has an invalid value|exactly two distinct/)
})

test('ordinary SQL comments are ignored and a declaration after SQL does not count', () => {
  assert.equal(parseDeclaration('-- Drops the stale index.\n-- migration-safety: expand\nDROP INDEX x;\n', pg('x')).class, 'expand')
  assert.throws(() => parseDeclaration('SELECT 1;\n-- migration-safety: expand\n', pg('x')), /missing a leading -- migration-safety declaration/)
  assert.throws(() => parseDeclaration('-- migration-safety: adjudicated\n-- adjudicated-class: contract\n-- removes: k\n-- incident: i\n-- adjudicated-at: 2026-10-28T12:00:00Z\n-- approved-by: @DGuang21, @dguang21\n-- backup: b\n-- ledger-reconciliation: l\n-- reason: r\n', pg('x')), /exactly two distinct/)
})

test('migration paths are recognized only in the four families', () => {
  assert.equal(classifyPath(pg('x')), 'migration')
  assert.equal(classifyPath(logs('x')), 'migration')
  assert.equal(classifyPath(d1('0001')), 'migration')
  assert.equal(classifyPath(fulltext('0001')), 'migration')
  assert.equal(classifyPath('apps/api/prisma/pg_migrations/migration_lock.toml'), 'lock')
  assert.equal(classifyPath('apps/api/prisma/logs_migrations/migration_lock.toml'), 'lock')
  assert.equal(classifyPath('apps/api/prisma/d1_migrations/README.md'), null)
  assert.equal(classifyPath('apps/api/prisma/migrations/20260101_x/migration.sql'), null)
  assert.equal(classifyPath('apps/api/prisma/schema.prisma'), null)
})

test('CODEOWNERS resolution is last-match-wins and accepts named users only', () => {
  assert.equal(ownersForPath(codeownersText, pg('x')).join(','), 'dguang21,boxcounter')
  assert.equal(ownersForPath('* @slax-lab/reader-core\n', pg('x')).join(','), '')
  assert.equal(ownersForPath('/apps/api/** @DGuang21 @slax-lab/reader-core\n', pg('x')).join(','), 'dguang21')
  assert.equal(ownersForPath('migration.sql @owner\n', pg('deep/nested')).join(','), 'owner')
  assert.equal(ownersForPath('/apps/api/prisma/** @first\n/apps/api/** @second\n', pg('x')).join(','), 'second')
  assert.ok(codeownersPattern('/apps/api/prisma/**').test(pg('add_value')))
  assert.ok(!codeownersPattern('/apps/api/prisma/**').test('apps/web/page.vue'))
  assert.ok(codeownersPattern('*.sql').test(pg('x')))
  assert.ok(!codeownersPattern('*.sql').test('apps/api/prisma/pg_migrations/x/migration.txt'))
})

test('review state uses each reviewer\'s latest review', () => {
  const latest = latestReviewStates([
    review('DGuang21', 'APPROVED', { submitted_at: '2026-10-27T00:00:00Z', id: 1 }),
    review('DGuang21', 'DISMISSED', { submitted_at: '2026-10-27T01:00:00Z', id: 2 }),
    review('boxcounter', 'APPROVED', { submitted_at: '2026-10-27T00:00:00Z', id: 3 })
  ])
  assert.equal(latest.get('dguang21').state, 'DISMISSED')
  assert.equal(latest.get('boxcounter').state, 'APPROVED')
})

test('promotion and sync-back pull requests are exempt from the OpenSpec trailer', () => {
  assert.equal(trailerExempt({ baseRef: 'beta', headRef: 'dev' }), true)
  assert.equal(trailerExempt({ baseRef: 'main', headRef: 'beta' }), true)
  assert.equal(trailerExempt({ baseRef: 'dev', headRef: 'main' }), true)
  assert.equal(trailerExempt({ baseRef: 'main', headRef: 'hotfix/urgent' }), false)
  assert.equal(trailerExempt({ baseRef: 'dev', headRef: 'hotfix/urgent' }), true)
  assert.equal(trailerExempt({ baseRef: 'dev', headRef: 'feat/topic' }), false)
})

test('an added expand migration with a named owner approval passes', async () => {
  const { result, calls } = await verify({ files: { [pg('add_value')]: expandText } }, { diff: [{ path: pg('add_value'), status: 'added' }] })
  assert.deepEqual(result.findings, [])
  assert.equal(result.ok, true)
  assert.deepEqual(result.current, [pg('add_value')])
  assert.ok(calls.some(([name, ref]) => name === 'fileSha' && ref === adoptionCommit))
  assert.ok(calls.some(([name]) => name === 'introducingPullRequest'))
  assert.ok(!calls.some(([name]) => name === 'servingCommit'))
})

test('a new migration without a declaration fails and names the path', async () => {
  const { result } = await verify({ files: { [d1('0002')]: 'CREATE TABLE t (id int);\n' } }, { diff: [{ path: d1('0002'), status: 'added' }] })
  assert.equal(result.ok, false)
  assert.deepEqual(stages(result), ['declaration'])
  assert.equal(result.findings[0].reference, d1('0002'))
})

test('ownership fails closed for teams, outsiders, head-only CODEOWNERS, and dismissed reviews', async () => {
  const diff = [{ path: pg('add_value'), status: 'added' }]
  const files = { [pg('add_value')]: expandText }

  const teamOnly = await verify({ files, codeowners: '* @slax-lab/reader-core\n' }, { diff })
  assert.deepEqual(stages(teamOnly.result), ['ownership'])
  assert.match(teamOnly.result.findings[0].message, /named user owner/)

  const outsider = await verify({ files, approvals: [review('outsider', 'APPROVED')] }, { diff })
  assert.deepEqual(stages(outsider.result), ['ownership'])

  const headGrant = await verify({ files, codeowners: '* @slax-lab/reader-core\n/apps/api/** @slax-lab/reader-core\n' }, { diff })
  assert.deepEqual(stages(headGrant.result), ['ownership'])

  const dismissed = await verify({
    files,
    approvals: [
      review('DGuang21', 'APPROVED', { submitted_at: '2026-10-27T00:00:00Z', id: 1 }),
      review('DGuang21', 'DISMISSED', { submitted_at: '2026-10-27T01:00:00Z', id: 2 })
    ]
  }, { diff })
  assert.deepEqual(stages(dismissed.result), ['ownership'])

  const ambiguous = await verify({ files, introducing: new EvidenceError('ownership', pg('add_value'), 'the migration must be introduced by exactly one merged pull request') }, { diff })
  assert.deepEqual(stages(ambiguous.result), ['ownership'])
})

test('API CI accepts the current open pull request as the introducing pull request', async () => {
  const path = pg('add_value')
  const current = { number: 731, state: 'open', merged: false, headSha, baseRef: 'beta', baseSha: ownerBase }
  const { result, calls } = await verify({ files: { [path]: expandText }, current }, { diff: [{ path, status: 'added' }], currentPullRequest: 731 })
  assert.equal(result.ok, true)
  assert.ok(calls.some(([name, number]) => name === 'currentPullRequest' && number === 731))
  assert.ok(!calls.some(([name]) => name === 'introducingPullRequest'), 'the open pull request replaces the merged lookup')

  const unapproved = await verify({ files: { [path]: expandText }, current, approvals: [review('outsider', 'APPROVED')] }, { diff: [{ path, status: 'added' }], currentPullRequest: 731 })
  assert.deepEqual(stages(unapproved.result), ['ownership'])
})

test('the current pull request must be open, at the release head, and target the base', async () => {
  const path = pg('add_value')
  const current = overrides => ({ number: 731, state: 'open', merged: false, headSha, baseRef: 'beta', baseSha: ownerBase, ...overrides })
  const cases = [
    ['closed', { state: 'closed' }],
    ['merged', { merged: true }],
    ['another head', { headSha: '9'.repeat(40) }],
    ['another base', { baseRef: 'main' }]
  ]
  for (const [name, override] of cases) {
    const { result } = await verify({ files: { [path]: expandText }, current: current(override) }, { diff: [{ path, status: 'added' }], currentPullRequest: 731 })
    assert.equal(result.ok, false, name)
    assert.deepEqual(stages(result), ['ownership'], name)
  }
})

test('promotion and deploy still require merged introducing provenance', async () => {
  const path = pg('drop_key')
  const files = { [path]: contractText }
  // The deploy surface resolves the merged pull request; an open one is not used there.
  const deploy = await verify({ files }, { diff: [{ path, status: 'added' }], surface: 'deploy', environment: 'beta', targetRef: 'beta', currentPullRequest: 731 })
  assert.equal(deploy.result.ok, true)
  assert.ok(deploy.calls.some(([name]) => name === 'introducingPullRequest'))
  assert.ok(!deploy.calls.some(([name]) => name === 'currentPullRequest'))

  const promotion = await verify({ files }, { diff: [{ path, status: 'added' }], surface: 'promotion', targetRef: 'beta' })
  assert.equal(promotion.result.ok, true)
  assert.ok(promotion.calls.some(([name]) => name === 'introducingPullRequest'))
  assert.ok(!promotion.calls.some(([name]) => name === 'currentPullRequest'))

  const unmerged = await verify({ files, introducing: new EvidenceError('ownership', path, 'the migration must be introduced by exactly one merged pull request') }, { diff: [{ path, status: 'added' }], surface: 'deploy', environment: 'beta', targetRef: 'beta' })
  assert.deepEqual(stages(unmerged.result), ['ownership'])
})

test('an expand-only release resolves no deployment evidence during an outage', async () => {
  const { result, calls } = await verify({
    files: { [pg('add_value')]: expandText },
    serving: { main: new EvidenceError('evidence', 'main', 'the deployments API is unavailable'), beta: new EvidenceError('evidence', 'beta', 'the deployments API is unavailable') }
  }, { diff: [{ path: pg('add_value'), status: 'added' }] })
  assert.equal(result.ok, true)
  assert.ok(!calls.some(([name]) => name === 'servingCommit'))
})

test('a contract passes only with a merged prerequisite, matching trailer, and full ancestry', async () => {
  const diff = [{ path: pg('drop_key'), status: 'added' }]
  const files = { [pg('drop_key')]: contractText }
  const { result, calls } = await verify({ files }, { diff })
  assert.deepEqual(result.findings, [])
  assert.deepEqual(calls.filter(([name]) => name === 'servingCommit').map(([, environment]) => environment), ['main', 'beta'])
  assert.ok(calls.some(([name, ancestor, descendant]) => name === 'ancestry' && ancestor === prereqMerge && descendant === betaSha))
})

test('contract prerequisite evidence fails on each broken condition', async () => {
  const diff = [{ path: pg('drop_key'), status: 'added' }]
  const files = { [pg('drop_key')]: contractText }
  const cases = [
    ['not merged', { pull: mergedPull({ merged: false }) }, 'prerequisite'],
    ['wrong merge commit', { pull: mergedPull({ mergeCommitSha: '9'.repeat(40) }) }, 'prerequisite'],
    ['trailer mismatch', { pull: mergedPull({ body: 'OpenSpec: another-change' }) }, 'prerequisite'],
    ['trailer missing', { pull: mergedPull({ body: 'No trailer here.' }) }, 'prerequisite'],
    ['not in main', { ancestry: (ancestor, descendant) => !(ancestor === prereqMerge && descendant === mainTip) }, 'prerequisite'],
    ['not in the release head', { ancestry: (ancestor, descendant) => !(ancestor === prereqMerge && descendant === headSha) }, 'prerequisite'],
    ['not in beta', { ancestry: (ancestor, descendant) => !(ancestor === prereqMerge && descendant === betaSha) }, 'evidence'],
    ['deployments unavailable', { serving: { main: new EvidenceError('evidence', 'main', 'the newest main API deployment is in_progress') } }, 'evidence']
  ]
  for (const [name, overrides, stage] of cases) {
    const { result } = await verify({ files, ...overrides }, { diff })
    assert.equal(result.ok, false, name)
    assert.ok(stages(result).includes(stage), `${name}: ${JSON.stringify(result.findings)}`)
  }
})

test('an implementation-only prerequisite may declare and carry n/a', async () => {
  const text = contractText.replace('-- prerequisite-change: example-removal', '-- prerequisite-change: n/a')
  const { result } = await verify({ files: { [pg('drop_key')]: text }, pull: mergedPull({ body: 'OpenSpec: n/a' }) }, { diff: [{ path: pg('drop_key'), status: 'added' }] })
  assert.equal(result.ok, true)
  const mismatch = await verify({ files: { [pg('drop_key')]: text }, pull: mergedPull({ body: 'OpenSpec: example-removal' }) }, { diff: [{ path: pg('drop_key'), status: 'added' }] })
  assert.equal(mismatch.result.ok, false)
})

test('a promotion or sync-back prerequisite skips the trailer comparison', async () => {
  const { result } = await verify({ files: { [pg('drop_key')]: contractText }, pull: mergedPull({ body: '', baseRef: 'beta', headRef: 'dev' }) }, { diff: [{ path: pg('drop_key'), status: 'added' }] })
  assert.equal(result.ok, true)
})

test('a historical contract that the diff does not touch is never revalidated', async () => {
  const { result, calls } = await verify({}, { diff: [] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.checked, [])
  assert.ok(!calls.some(([name]) => name === 'pullRequest' || name === 'servingCommit'))
})

test('release-diff immutability rejects deletes, renames, released edits, and lock changes', async () => {
  const removed = await verify({}, { diff: [{ path: pg('old'), status: 'removed' }] })
  assert.deepEqual(stages(removed.result), ['immutability'])
  assert.match(removed.result.findings[0].message, /removed a migration/)

  const renamed = await verify({}, { diff: [{ path: pg('new'), status: 'renamed', previousPath: pg('old') }] })
  assert.deepEqual(stages(renamed.result), ['immutability'])

  const released = await verify({ existing: { main: { [pg('old')]: 'released copy' } } }, { diff: [{ path: pg('old'), status: 'modified' }] })
  assert.deepEqual(stages(released.result), ['immutability'])
  assert.match(released.result.findings[0].message, /must not be modified/)

  const frozen = await verify({ existing: { [adoptionCommit]: { [pg('old')]: 'adopted copy' } } }, { diff: [{ path: pg('old'), status: 'modified' }] })
  assert.deepEqual(stages(frozen.result), ['immutability'])

  const readded = await verify({ files: { [pg('old')]: expandText }, existing: { target: { [pg('old')]: expandText } } }, { diff: [{ path: pg('old'), status: 'added' }] })
  assert.deepEqual(stages(readded.result), ['immutability'])
  assert.match(readded.result.findings[0].message, /already carried this migration before the release/)

  const lock = await verify({}, { diff: [{ path: 'apps/api/prisma/pg_migrations/migration_lock.toml', status: 'modified' }] })
  assert.deepEqual(stages(lock.result), ['immutability'])
  assert.match(lock.result.findings[0].message, /migration_lock\.toml/)
})

test('a normal beta deploy of a new migration passes although beta now contains it', async () => {
  // The deploy runs on the merge commit, so beta's live tip already holds the
  // migration. The target is judged at the pre-release parent instead.
  const path = pg('new_one')
  const { result, calls } = await verify({ files: { [path]: expandText } }, { diff: [{ path, status: 'added' }], surface: 'deploy', environment: 'beta', targetRef: 'beta', targetCommit: '3'.repeat(40) })
  assert.equal(result.ok, true)
  assert.deepEqual(result.current, [path])
  assert.ok(calls.some(([name, ref]) => name === 'fileSha' && ref === '3'.repeat(40)))
  assert.ok(!calls.some(([name, ref]) => name === 'fileSha' && ref === 'beta'))
})

test('a beta-to-main promotion passes when the migrations come from beta', async () => {
  const path = pg('carried')
  const { result, calls } = await verify({ files: { [path]: expandText }, existing: { beta: { [path]: expandText } } }, { diff: [{ path, status: 'added' }], targetRef: 'main', environment: 'main', surface: 'pull-request', targetCommit: '4'.repeat(40) })
  assert.equal(result.ok, true)
  assert.deepEqual(result.current, [])
  assert.deepEqual(result.frozen, [path])
  assert.ok(!calls.some(([name]) => name === 'readMigration' || name === 'introducingPullRequest'))
})

test('an actual re-add of a path the target already carried fails on immutability', async () => {
  const path = pg('diverged')
  const { result } = await verify({ files: { [path]: expandText }, existing: { target: { [path]: expandText } } }, { diff: [{ path, status: 'added' }], targetRef: 'main', environment: 'main', targetCommit: '4'.repeat(40) })
  assert.deepEqual(stages(result), ['immutability'])
  assert.match(result.findings[0].message, /the main branch already carried this migration before the release/)
})

test('the deploy target is judged at its pre-release parent, not the live branch', async () => {
  const path = pg('again')
  const { result } = await verify({ files: { [path]: expandText }, existing: { target: { [path]: expandText } } }, { diff: [{ path, status: 'added' }], surface: 'deploy', environment: 'main', targetRef: 'main', targetCommit: '5'.repeat(40) })
  assert.deepEqual(stages(result), ['immutability'])
})

test('an adoption-era migration still on its way to beta is frozen, not current', async () => {
  const { result, calls } = await verify({ files: { [pg('old')]: expandText }, existing: { [adoptionCommit]: { [pg('old')]: expandText } } }, { diff: [{ path: pg('old'), status: 'added' }] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.current, [])
  assert.deepEqual(result.frozen, [pg('old')])
  assert.ok(!calls.some(([name]) => name === 'readMigration' || name === 'introducingPullRequest'))
})

test('a hotfix migration propagated back to dev is historical, not a re-add failure', async () => {
  const { result } = await verify({ files: { [pg('x')]: expandText }, existing: { main: { [pg('x')]: expandText } } }, { diff: [{ path: pg('x'), status: 'added' }], surface: 'deploy', environment: 'dev', targetRef: 'dev' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.current, [])
  assert.deepEqual(result.frozen, [pg('x')])
})

test('an in-flight dev migration may be edited and needs no declaration', async () => {
  const { result, calls } = await verify({}, { diff: [{ path: pg('in_flight'), status: 'modified' }] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.current, [])
  assert.ok(!calls.some(([name]) => name === 'readMigration'))
})

test('a lagging branch is not reported as a deletion', async () => {
  const { result } = await verify({ existing: { main: { [pg('only_on_main')]: 'x' } } }, { diff: [] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.findings, [])
})

test('divergent content under an existing path fails immutability and stays current', async () => {
  const path = pg('diverged')
  const promotion = await verify({ files: { [path]: expandText }, existing: { beta: { [path]: contractText } } }, { diff: [{ path, status: 'added' }], targetRef: 'main', environment: 'main', targetCommit: '4'.repeat(40) })
  assert.ok(stages(promotion.result).includes('immutability'))
  assert.deepEqual(promotion.result.current, [path], 'a divergent file is not frozen')
  assert.deepEqual(promotion.result.frozen, [])
  assert.match(promotion.result.findings.find(finding => finding.stage === 'immutability').message, /differs from the copy on the beta branch/)

  const deploy = await verify({ files: { [path]: expandText }, existing: { main: { [path]: contractText } } }, { diff: [{ path, status: 'added' }], surface: 'deploy', environment: 'beta', targetRef: 'beta' })
  assert.ok(stages(deploy.result).includes('immutability'))
  assert.deepEqual(deploy.result.frozen, [])

  const adoption = await verify({ files: { [path]: expandText }, existing: { [adoptionCommit]: { [path]: contractText } } }, { diff: [{ path, status: 'added' }], surface: 'deploy', environment: 'dev', targetRef: 'dev' })
  assert.ok(stages(adoption.result).includes('immutability'))
  assert.match(adoption.result.findings.find(finding => finding.stage === 'immutability').message, /differs from the copy on the pinned dev adoption commit/)
})

test('a hotfix cannot ship a non-expand migration by reusing a shared copy', async () => {
  const path = pg('hotfix_contract')
  const identical = await verify({ files: { [path]: contractText }, existing: { beta: { [path]: contractText } } }, { diff: [{ path, status: 'added' }], headRef: 'hotfix/urgent', targetRef: 'main' })
  assert.deepEqual(stages(identical.result), ['declaration'])
  assert.match(identical.result.findings[0].message, /a hotfix may add only expand migrations/)
  assert.deepEqual(identical.result.frozen, [path])

  const divergent = await verify({ files: { [path]: migrateText }, existing: { beta: { [path]: contractText } } }, { diff: [{ path, status: 'added' }], headRef: 'hotfix/urgent', targetRef: 'main' })
  assert.ok(stages(divergent.result).includes('immutability'))
  assert.ok(stages(divergent.result).includes('declaration'))
})

test('a hotfix that diverges from a shared copy cannot skip the declaration', async () => {
  // The round-2 reproduction: same path on beta, different head content, no
  // declaration. It must fail both immutability and declaration, and the
  // release head content must actually be read.
  const path = d1('0002_divergent')
  const { result, calls } = await verify({ files: { [path]: 'ALTER TABLE t ADD COLUMN c int;\n' }, existing: { beta: { [path]: contractText } } }, { diff: [{ path, status: 'added' }], headRef: 'hotfix/divergent', targetRef: 'main' })
  assert.equal(result.ok, false)
  assert.deepEqual(stages(result).sort(), ['declaration', 'immutability'])
  assert.deepEqual(result.frozen, [])
  assert.deepEqual(result.current, [path])
  assert.ok(calls.some(([name, calledPath]) => name === 'readMigration' && calledPath === path))
})

test('a hotfix may add only expand migrations', async () => {
  const expand = await verify({ files: { [d1('0003')]: expandText } }, { diff: [{ path: d1('0003'), status: 'added' }], headRef: 'hotfix/urgent', targetRef: 'main' })
  assert.equal(expand.result.ok, true)

  for (const [name, text] of [['migrate', migrateText], ['contract', contractText], ['adjudicated', adjudicatedText]]) {
    const { result } = await verify({ files: { [pg('change')]: text } }, { diff: [{ path: pg('change'), status: 'added' }], headRef: 'hotfix/urgent', targetRef: 'main' })
    assert.equal(result.ok, false, name)
    assert.deepEqual(stages(result), ['declaration'], name)
    assert.match(result.findings[0].message, /hotfix may add only expand/, name)
  }

  const propagation = await verify({ files: { [pg('change')]: contractText } }, { diff: [{ path: pg('change'), status: 'added' }], headRef: 'hotfix/urgent', targetRef: 'dev' })
  assert.equal(propagation.result.ok, true)
})

test('the adjudicated overlay requires two approved named owners and its emergency fields', async () => {
  const diff = [{ path: pg('drop_now'), status: 'added' }]
  const files = { [pg('drop_now')]: adjudicatedText }
  const both = [review('DGuang21', 'APPROVED'), review('boxcounter', 'APPROVED')]
  const passing = await verify({ files, approvals: both }, { diff })
  assert.equal(passing.result.ok, true)
  assert.ok(!passing.calls.some(([name]) => name === 'pullRequest' || name === 'servingCommit'))

  const one = await verify({ files, approvals: [review('DGuang21', 'APPROVED')] }, { diff })
  assert.deepEqual(stages(one.result), ['ownership'])

  const outsider = await verify({ files, approvals: [...both, review('outsider', 'APPROVED')], codeowners: '* @slax-lab/reader-core\n/apps/api/prisma/** @DGuang21 @slax-lab/reader-core\n' }, { diff })
  assert.deepEqual(stages(outsider.result), ['ownership'])

  const missingField = adjudicatedText.replace('-- backup: R2 snapshot backup-20261028\n', '')
  const missing = await verify({ files: { [pg('drop_now')]: missingField }, approvals: both }, { diff })
  assert.deepEqual(stages(missing.result), ['declaration'])

  const hotfix = await verify({ files, approvals: both }, { diff, headRef: 'hotfix/urgent', targetRef: 'main' })
  assert.deepEqual(stages(hotfix.result), ['declaration'])
})

test('a dev deploy checks declarations and immutability but skips ownership and prerequisite evidence', async () => {
  const { result, calls } = await verify({ files: { [pg('drop_key')]: contractText } }, { diff: [{ path: pg('drop_key'), status: 'added' }], surface: 'deploy', environment: 'dev', targetRef: 'dev' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.skipped, ['ownership', 'prerequisite', 'evidence'])
  assert.ok(!calls.some(([name]) => ['introducingPullRequest', 'reviews', 'servingCommit', 'pullRequest'].includes(name)))

  const broken = await verify({ files: { [pg('drop_key')]: 'DROP INDEX x;\n' } }, { diff: [{ path: pg('drop_key'), status: 'added' }], surface: 'deploy', environment: 'dev', targetRef: 'dev' })
  assert.deepEqual(stages(broken.result), ['declaration'])
})

test('a GitHub API failure reports a public reference and never echoes the response', async () => {
  const { result } = await verify({ files: { [pg('add_value')]: expandText }, reviews: new EvidenceError('evidence', 'GitHub API', 'a GitHub API request failed (HTTP 503)') }, { diff: [{ path: pg('add_value'), status: 'added' }] })
  assert.equal(result.ok, false)
  assert.deepEqual(result.findings, [{ stage: 'evidence', reference: pg('add_value'), message: 'a GitHub API request failed (HTTP 503)' }])
  assert.doesNotMatch(JSON.stringify(result), /fixture-private|Authorization|Bearer/)
})

test('every reported stage is one of the fixed stage names', async () => {
  const cases = [
    [{ files: { [d1('0002')]: 'SELECT 1;\n' } }, [{ path: d1('0002'), status: 'added' }]],
    [{}, [{ path: pg('old'), status: 'removed' }]],
    [{ files: { [pg('drop_key')]: contractText }, pull: mergedPull({ merged: false }) }, [{ path: pg('drop_key'), status: 'added' }]]
  ]
  for (const [overrides, diff] of cases) {
    const { result } = await verify(overrides, { diff })
    for (const stage of stages(result)) assert.ok(stageNames.includes(stage), stage)
  }
})

function diffRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'migration-evidence-diff-'))
  const run = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8' })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 'fixture@example.com'])
  run(['config', 'user.name', 'Fixture'])
  const write = (path, content) => {
    mkdirSync(join(directory, path, '..'), { recursive: true })
    writeFileSync(join(directory, path), content)
  }
  write(d1('0001_init'), 'CREATE TABLE t (id int);\n')
  write(d1('0003_rename'), 'CREATE TABLE u (id int);\n')
  write(pg('20260101_old'), 'ALTER TABLE t ADD COLUMN a int;\n')
  run(['add', '.'])
  run(['commit', '-q', '-m', 'base'])
  const base = run(['rev-parse', 'HEAD']).trim()

  write(d1('0002_add'), '-- migration-safety: expand\nALTER TABLE t ADD COLUMN b int;\n')
  execFileSync('git', ['mv', d1('0003_rename'), d1('0004_renamed')], { cwd: directory })
  run(['rm', '-q', d1('0001_init')])
  write(pg('20260101_old'), 'ALTER TABLE t ADD COLUMN a int, ADD COLUMN c int;\n')
  run(['add', '.'])
  run(['commit', '-q', '-m', 'change'])
  const head = run(['rev-parse', 'HEAD']).trim()
  return { directory, base, head, run }
}

test('the Git release diff classifies adds, edits, deletes, and renames', () => {
  const { directory, base, head } = diffRepository()
  try {
    const entries = parseGitDiff({ cwd: directory, base, head })
    const byPath = new Map(entries.map(entry => [entry.path, entry]))
    assert.equal(byPath.get(d1('0002_add')).status, 'added')
    assert.equal(byPath.get(d1('0001_init')).status, 'removed')
    assert.equal(byPath.get(pg('20260101_old')).status, 'modified')
    assert.equal(byPath.get(d1('0004_renamed')).status, 'renamed')
    assert.equal(byPath.get(d1('0004_renamed')).previousPath, d1('0003_rename'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

const sha1 = value => createHash('sha1').update(value).digest('hex')
const treeEntry = (path, variant = '') => ({ path, type: 'blob', sha: sha1(`${path}:${variant}`) })

function treeFetch(trees, { truncated = false, compareFails = false } = {}) {
  return async url => {
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.includes('/compare/')) {
      if (compareFails) return new Response('{"message":"Not Found"}', { status: 404, headers: { 'content-type': 'application/json' } })
      return json({ status: 'ahead', merge_base_commit: { sha: '4'.repeat(40) } })
    }
    const ref = url.match(/\/git\/trees\/([a-f0-9]{40})\?recursive=1/)[1]
    return json({ truncated, tree: trees[ref] ?? [] })
  }
}

test('the promotion diff enumerates only migration paths from both versioned trees', async () => {
  const base = '4'.repeat(40)
  const movedSha = treeEntry(d1('0001_old')).sha
  const trees = {
    [base]: [treeEntry(pg('kept')), treeEntry(pg('edited'), 'before'), treeEntry(pg('deleted')), { path: d1('0001_old'), type: 'blob', sha: movedSha }, { path: 'apps/web/page.vue', type: 'blob', sha: sha1('page') }],
    [headSha]: [treeEntry(pg('kept')), treeEntry(pg('edited'), 'after'), { path: d1('0001_new'), type: 'blob', sha: movedSha }, treeEntry(d1('0002')), { path: 'apps/web/page.vue', type: 'blob', sha: sha1('page-changed') }]
  }
  const entries = await releaseDiffFromTrees({ repository, token: 'fixture-token', fetchImpl: treeFetch(trees), base: 'beta', head: headSha })
  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  assert.equal(byPath.get(d1('0002')).status, 'added')
  assert.equal(byPath.get(d1('0001_new')).status, 'renamed')
  assert.equal(byPath.get(d1('0001_new')).previousPath, d1('0001_old'))
  assert.equal(byPath.get(pg('edited')).status, 'modified')
  assert.equal(byPath.get(pg('deleted')).status, 'removed')
  assert.equal(byPath.get(pg('kept')), undefined)
  assert.equal(byPath.has('apps/web/page.vue'), false)
  assert.equal(entries.length, 4)
})

test('a promotion diff larger than 300 files is still enumerated completely', async () => {
  const base = '4'.repeat(40)
  const trees = {
    [base]: [],
    [headSha]: [...Array.from({ length: 900 }, (_, index) => treeEntry(`apps/web/file-${index}.vue`)), treeEntry(d1('0002'))]
  }
  const entries = await releaseDiffFromTrees({ repository, token: 'fixture-token', fetchImpl: treeFetch(trees), base: 'beta', head: headSha })
  assert.deepEqual(entries, [{ path: d1('0002'), status: 'added' }])
})

test('a truncated tree listing or an unresolvable merge base fails closed', async () => {
  await assert.rejects(releaseDiffFromTrees({ repository, token: 'fixture-token', fetchImpl: treeFetch({}, { truncated: true }), base: 'beta', head: headSha }), /tree listing is truncated/)
  await assert.rejects(releaseDiffFromTrees({ repository, token: 'fixture-token', fetchImpl: treeFetch({}, { compareFails: true }), base: 'beta', head: headSha }), /merge base is unavailable/)
})

function servingFixture(overrides = {}) {
  const deployment = (id, sha, createdAt) => ({ id, sha, created_at: createdAt, environment: 'beta' })
  const status = (runId, createdAt = '2026-10-27T00:00:00Z') => ({ state: 'success', created_at: createdAt, log_url: `https://github.com/${repository}/actions/runs/${runId}/job/7` })
  const run = (overrides = {}) => ({ path: '.github/workflows/api-deploy.yml', head_sha: headSha, status: 'completed', conclusion: 'success', ...overrides })
  const jobs = name => ({ jobs: [{ name: 'deploy', steps: [{ name, conclusion: 'success' }] }] })
  const routes = {
    deployments: overrides.deployments ?? [deployment(10, headSha, '2026-10-27T00:00:00Z')],
    statuses: overrides.statuses ?? { 10: [status(5000)] },
    runs: overrides.runs ?? { 5000: run() },
    jobs: overrides.jobs ?? { 5000: jobs('Migrate databases and deploy Workers') }
  }
  const list = async path => {
    if (path.includes('/deployments?')) return routes.deployments
    const statusMatch = path.match(/\/deployments\/(\d+)\/statuses/)
    if (statusMatch) return routes.statuses[Number(statusMatch[1])] ?? []
    const jobsMatch = path.match(/\/actions\/runs\/(\d+)\/jobs/)
    if (jobsMatch) return (routes.jobs[Number(jobsMatch[1])] ?? { jobs: [] }).jobs
    throw new Error(`unexpected list ${path}`)
  }
  const get = async path => {
    const match = path.match(/\/actions\/runs\/(\d+)$/)
    if (match) return { body: routes.runs[Number(match[1])] }
    throw new Error(`unexpected get ${path}`)
  }
  return { list, get }
}

test('the deployment resolver reads the newest api-deploy deployment and its migration step', async () => {
  const { list, get } = servingFixture()
  assert.deepEqual(await resolveServingCommit('beta', { repository, list, get }), { environment: 'beta', sha: headSha })
})

test('the deployment resolver freezes on a failed, cancelled, or in-progress newest run', async () => {
  for (const [name, run] of [['failed', { status: 'completed', conclusion: 'failure' }], ['cancelled', { status: 'completed', conclusion: 'cancelled' }], ['in progress', { status: 'in_progress', conclusion: null }]]) {
    const { list, get } = servingFixture({ runs: { 5000: { path: '.github/workflows/api-deploy.yml', head_sha: headSha, ...run } } })
    await assert.rejects(resolveServingCommit('beta', { repository, list, get }), /newest beta API deployment/, name)
  }
})

test('a superseded run that skipped the migration step is not serving evidence', async () => {
  const { list, get } = servingFixture({ jobs: { 5000: { jobs: [{ name: 'deploy', steps: [{ name: 'Migrate databases and deploy Workers', conclusion: 'skipped' }] }] } } })
  await assert.rejects(resolveServingCommit('beta', { repository, list, get }), /did not run the migration and publication step/)
  const missing = servingFixture({ jobs: { 5000: { jobs: [{ name: 'deploy', steps: [] }] } } })
  await assert.rejects(resolveServingCommit('beta', { repository, list, get: missing.get, list: missing.list }), /has no migration and publication step/)
})

test('duplicate deployments for one commit are deduplicated and non-API deployments are skipped', async () => {
  const duplicate = servingFixture({
    deployments: [
      { id: 10, sha: headSha, created_at: '2026-10-27T00:00:00Z' },
      { id: 11, sha: headSha, created_at: '2026-10-27T00:00:00Z' }
    ],
    statuses: { 10: [{ state: 'success', created_at: '2026-10-27T00:00:00Z', log_url: `https://github.com/${repository}/actions/runs/5000/job/7` }] }
  })
  assert.deepEqual(await resolveServingCommit('beta', { repository, list: duplicate.list, get: duplicate.get }), { environment: 'beta', sha: headSha })
  await assert.rejects(resolveServingCommit('beta', { repository, list: duplicate.list, get: duplicate.get }), /./).catch(() => {})

  const mixed = servingFixture({
    deployments: [
      { id: 12, sha: '9'.repeat(40), created_at: '2026-10-28T00:00:00Z' },
      { id: 10, sha: headSha, created_at: '2026-10-27T00:00:00Z' }
    ],
    statuses: {
      12: [{ state: 'success', created_at: '2026-10-28T00:00:00Z', log_url: `https://github.com/${repository}/actions/runs/6000/job/7` }],
      10: [{ state: 'success', created_at: '2026-10-27T00:00:00Z', log_url: `https://github.com/${repository}/actions/runs/5000/job/7` }]
    },
    runs: { 6000: { path: '.github/workflows/web-deploy.yml', head_sha: '9'.repeat(40), status: 'completed', conclusion: 'success' }, 5000: { path: '.github/workflows/api-deploy.yml', head_sha: headSha, status: 'completed', conclusion: 'success' } }
  })
  assert.deepEqual(await resolveServingCommit('beta', { repository, list: mixed.list, get: mixed.get }), { environment: 'beta', sha: headSha })
})

test('the GitHub evidence source reads the actions jobs envelope and dedupes deployments', async () => {
  const routes = [
    [/\/deployments\?environment=beta/, () => new Response(JSON.stringify([{ id: 10, sha: headSha, created_at: '2026-10-27T00:00:00Z' }]), { status: 200, headers: { 'content-type': 'application/json' } })],
    [/\/deployments\/10\/statuses\?/, () => new Response(JSON.stringify([{ state: 'success', created_at: '2026-10-27T00:00:00Z', log_url: `https://github.com/${repository}/actions/runs/5000/job/7` }]), { status: 200, headers: { 'content-type': 'application/json' } })],
    [/\/actions\/runs\/5000$/, () => new Response(JSON.stringify({ path: '.github/workflows/api-deploy.yml', head_sha: headSha, status: 'completed', conclusion: 'success' }), { status: 200, headers: { 'content-type': 'application/json' } })],
    [/\/actions\/runs\/5000\/jobs\?/, () => new Response(JSON.stringify({ total_count: 1, jobs: [{ name: 'deploy', steps: [{ name: 'Migrate databases and deploy Workers', conclusion: 'success' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } })]
  ]
  const fetchImpl = async url => {
    for (const [pattern, handler] of routes) if (pattern.test(url)) return handler()
    throw new Error(`Unexpected request: ${url}`)
  }
  const evidence = createGithubEvidence({ repository, token: 'fixture-token', fetchImpl })
  assert.deepEqual(await evidence.servingCommit('beta'), { environment: 'beta', sha: headSha })
})

test('a same-commit web success never hides a newer API failure', async () => {
  const fixture = servingFixture({
    deployments: [
      { id: 20, sha: headSha, created_at: '2026-10-28T00:00:00Z' },
      { id: 10, sha: headSha, created_at: '2026-10-27T00:00:00Z' },
      { id: 5, sha: '9'.repeat(40), created_at: '2026-10-26T00:00:00Z' }
    ],
    statuses: {
      20: [{ state: 'success', created_at: '2026-10-28T00:00:00Z', log_url: `https://github.com/${repository}/actions/runs/7000/job/7` }],
      10: [{ state: 'success', created_at: '2026-10-27T00:00:00Z', log_url: `https://github.com/${repository}/actions/runs/5000/job/7` }],
      5: [{ state: 'success', created_at: '2026-10-26T00:00:00Z', log_url: `https://github.com/${repository}/actions/runs/4000/job/7` }]
    },
    runs: {
      7000: { path: '.github/workflows/web-deploy.yml', head_sha: headSha, status: 'completed', conclusion: 'success' },
      5000: { path: '.github/workflows/api-deploy.yml', head_sha: headSha, status: 'completed', conclusion: 'failure' },
      4000: { path: '.github/workflows/api-deploy.yml', head_sha: '9'.repeat(40), status: 'completed', conclusion: 'success' }
    }
  })
  await assert.rejects(resolveServingCommit('main', { repository, list: fixture.list, get: fixture.get }), /newest main API deployment is failure/)
})

test('a same-commit web record does not consume the commit before the API record is read', async () => {
  const fixture = servingFixture({
    deployments: [
      { id: 20, sha: headSha, created_at: '2026-10-28T00:00:00Z' },
      { id: 10, sha: headSha, created_at: '2026-10-27T00:00:00Z' }
    ],
    statuses: {
      20: [{ state: 'success', created_at: '2026-10-28T00:00:00Z', log_url: `https://github.com/${repository}/actions/runs/7000/job/7` }],
      10: [{ state: 'success', created_at: '2026-10-27T00:00:00Z', log_url: `https://github.com/${repository}/actions/runs/5000/job/7` }]
    },
    runs: {
      7000: { path: '.github/workflows/web-deploy.yml', head_sha: headSha, status: 'completed', conclusion: 'success' },
      5000: { path: '.github/workflows/api-deploy.yml', head_sha: headSha, status: 'completed', conclusion: 'success' }
    }
  })
  assert.deepEqual(await resolveServingCommit('main', { repository, list: fixture.list, get: fixture.get }), { environment: 'main', sha: headSha })
})

function cliRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'migration-evidence-cli-'))
  const run = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8' })
  run(['init', '-q', '-b', 'main'])
  run(['config', 'user.email', 'fixture@example.com'])
  run(['config', 'user.name', 'Fixture'])
  mkdirSync(join(directory, 'apps/api/prisma/d1_migrations'), { recursive: true })
  writeFileSync(join(directory, d1('0001_init')), 'CREATE TABLE t (id int);\n')
  run(['add', '.'])
  run(['commit', '-q', '-m', 'base'])
  const base = run(['rev-parse', 'HEAD']).trim()
  run(['update-ref', 'refs/remotes/origin/main', base])
  run(['update-ref', 'refs/remotes/origin/beta', base])
  return { directory, base, run }
}

const emptyGithub = async () => new Response('{"message":"Not Found"}', { status: 404, headers: { 'content-type': 'application/json' } })
const cliEnv = { GITHUB_REPOSITORY: repository, GH_TOKEN: 'fixture-token' }

test('the CLI passes an explicit expand migration on a synthetic dev deploy', async () => {
  const { directory, base, run } = cliRepository()
  try {
    writeFileSync(join(directory, d1('0002_add')), '-- migration-safety: expand\nALTER TABLE t ADD COLUMN b int;\n')
    run(['add', '.'])
    run(['commit', '-q', '-m', 'add'])
    const head = run(['rev-parse', 'HEAD']).trim()
    const lines = []
    const result = await runCli({
      argv: ['--surface', 'deploy', '--base', `${head}^1`, '--head', head, '--base-ref', 'dev', '--head-ref', 'dev', '--environment', 'dev'],
      env: cliEnv,
      cwd: directory,
      fetchImpl: emptyGithub,
      log: message => lines.push(message),
      errorLog: message => lines.push(`error: ${message}`)
    })
    assert.equal(result.ok, true)
    assert.deepEqual(lines, ['migration release evidence: pass (1 migration path(s), 1 current)'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the CLI fails an undeclared, deleted, or re-released migration on a synthetic dev deploy', async () => {
  const { directory, base, run } = cliRepository()
  try {
    writeFileSync(join(directory, d1('0002_add')), 'ALTER TABLE t ADD COLUMN b int;\n')
    run(['add', '.'])
    run(['commit', '-q', '-m', 'undeclared'])
    const undeclared = run(['rev-parse', 'HEAD']).trim()
    const errors = []
    const result = await runCli({
      argv: ['--surface', 'deploy', '--base', `${undeclared}^1`, '--head', undeclared, '--base-ref', 'dev', '--environment', 'dev'],
      env: cliEnv, cwd: directory, fetchImpl: emptyGithub, log: () => {}, errorLog: message => errors.push(message)
    })
    assert.equal(result.ok, false)
    assert.ok(errors.some(line => line.startsWith(`declaration: ${d1('0002_add')}`)))

    run(['rm', '-q', d1('0001_init')])
    run(['commit', '-q', '-m', 'delete'])
    const deleted = run(['rev-parse', 'HEAD']).trim()
    const removal = await runCli({
      argv: ['--surface', 'deploy', '--base', `${deleted}^1`, '--head', deleted, '--base-ref', 'dev', '--environment', 'dev'],
      env: cliEnv, cwd: directory, fetchImpl: emptyGithub, log: () => {}, errorLog: () => {}
    })
    assert.equal(removal.ok, false)
    assert.deepEqual(stages(removal), ['immutability'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the CLI judges a beta deploy target at the pre-release parent', async () => {
  const { directory, run } = cliRepository()
  try {
    writeFileSync(join(directory, d1('0002_add')), expandText)
    run(['add', '.'])
    run(['commit', '-q', '-m', 'add'])
    const head = run(['rev-parse', 'HEAD']).trim()
    // The merge is already on beta, so the live ref holds the migration.
    run(['update-ref', 'refs/remotes/origin/beta', head])
    const result = await runCli({
      argv: ['--surface', 'deploy', '--base', `${head}^1`, '--head', head, '--base-ref', 'beta', '--environment', 'beta'],
      env: cliEnv, cwd: directory, fetchImpl: emptyGithub, log: () => {}, errorLog: () => {}
    })
    assert.equal(result.ok, false)
    assert.ok(!stages(result).includes('immutability'), 'the deploy must not be rejected as a re-add')
    assert.deepEqual(stages(result), ['evidence'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the CLI fails closed when the frozen branch trees are not fetched', async () => {
  const { directory, base, run } = cliRepository()
  try {
    run(['update-ref', '-d', 'refs/remotes/origin/main'])
    writeFileSync(join(directory, d1('0002_add')), '-- migration-safety: expand\nALTER TABLE t ADD COLUMN b int;\n')
    run(['add', '.'])
    run(['commit', '-q', '-m', 'add'])
    const head = run(['rev-parse', 'HEAD']).trim()
    const result = await runCli({
      argv: ['--surface', 'deploy', '--base', `${head}^1`, '--head', head, '--base-ref', 'beta', '--environment', 'beta'],
      env: cliEnv, cwd: directory, fetchImpl: emptyGithub, log: () => {}, errorLog: () => {}
    })
    assert.equal(result.ok, false)
    assert.deepEqual(stages(result), ['evidence'])
    assert.match(result.findings[0].message, /main branch tree is not fetched/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('CLI arguments require a surface, refs, and a release head', () => {
  assert.deepEqual(parseCliArgs(['--surface', 'deploy', '--base', `${headSha}^1`, '--head', headSha, '--base-ref', 'beta']), {
    surface: 'deploy', base: `${headSha}^1`, head: headSha, baseRef: 'beta', headRef: '', pullRequest: undefined, environment: 'beta'
  })
  assert.equal(parseCliArgs(['--surface', 'pull-request', '--base', headSha, '--head', headSha, '--base-ref', 'dev', '--pull-request', '731']).pullRequest, 731)
  assert.throws(() => parseCliArgs(['--surface', 'pull-request', '--base', headSha, '--head', headSha, '--base-ref', 'dev', '--pull-request', '0']), /positive number/)
  assert.throws(() => parseCliArgs(['--surface', 'wrong', '--base', headSha, '--head', headSha, '--base-ref', 'dev']), /surface/)
  assert.throws(() => parseCliArgs(['--surface', 'deploy', '--head', headSha, '--base-ref', 'dev']), /Missing --base/)
  assert.throws(() => parseCliArgs(['--surface', 'deploy', '--base', headSha, '--head', headSha]), /Missing --base-ref/)
  assert.throws(() => parseCliArgs(['--surface', 'promotion', '--base', 'dev', '--head', 'dev', '--base-ref', 'beta']), /--head/)
  assert.throws(() => parseCliArgs(['--surface', 'deploy', '--base', headSha, '--head', headSha, '--base-ref', 'dev', '--environment', 'staging']), /environment/)
})

test('the verifier contains no SQL parser or statement classification', () => {
  const source = readFileSync(new URL('./migration-release-evidence.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|ALTER|CREATE|DROP|GRANT|TRUNCATE)\b/)
})
