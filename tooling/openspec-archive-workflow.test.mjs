import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('rulesync'))('js-yaml')
const source = () => {
  const raw = readFileSync(new URL('../.github/workflows/openspec-archive.md', import.meta.url), 'utf8')
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(match, 'archive workflow must have a gh-aw frontmatter block')
  return { config: load(match[1]), body: raw.slice(match[0].length) }
}

test('archive evaluation runs only for merged dev PRs or an explicit replay and is globally serialized', () => {
  const { config } = source()
  assert.deepEqual(config.on.pull_request, { types: ['closed'], branches: ['dev'] })
  const replay = config.on.workflow_dispatch.inputs.issue_number
  assert.equal(replay.description, 'Merged task pull request number to re-evaluate')
  assert.equal(replay.required, true)
  assert.equal(replay.type, 'number')
  assert.equal(config.if, "vars.OPENSPEC_ARCHIVE_ENABLED != 'false' && (github.event_name != 'pull_request' || github.event.pull_request.merged == true)")
  assert.deepEqual(config.concurrency, { group: 'openspec-archive-dev', 'cancel-in-progress': false })
})

test('agent permissions stay read-only and Safe Outputs only create an archive PR or report on the source PR', () => {
  const { config } = source()
  assert.deepEqual(config.permissions, { contents: 'read', 'pull-requests': 'read', 'copilot-requests': 'none' })
  const outputs = config.safe_outputs ?? config['safe-outputs']
  assert.equal(outputs['report-failure-as-issue'], false)
  assert.equal(outputs['threat-detection']['continue-on-error'], false)
  assert.equal(outputs.noop['report-as-issue'], false)
  assert.deepEqual(outputs['add-comment'], { max: 1, target: '*' })
  assert.equal(outputs['create-pull-request']['title-prefix'], 'docs(openspec): archive ')
  assert.deepEqual(outputs['create-pull-request']['team-reviewers'], ['reader-core'])
  assert.equal(outputs['create-pull-request'].reviewers, undefined)
  for (const forbidden of ['merge-pull-request', 'submit-pull-request-review', 'push-to-pull-request-branch', 'create-issue']) {
    assert.equal(outputs[forbidden], undefined, `${forbidden} must not be enabled`)
  }
})

test('archive prompt requires evidence-based classification and same-capability ordering', () => {
  const { body } = source()
  for (const expected of [
    'Read `proposal.md`, `tasks.md`, `design.md` when present, `validation.md`, and every delta spec',
    'Only evidence-backed completed work may be checked off',
    'Genuinely unfinished or uncertain work blocks archiving',
    'accepted historical gap',
    'same capability',
    'declared archive order',
    'Do not invent requirement text',
  ]) assert.ok(body.includes(expected), `missing classification contract: ${expected}`)
})

test('archive prompt validates the result and prevents duplicate archive PRs', () => {
  const { body } = source()
  for (const expected of [
    'openspec archive <change-id> --yes',
    'openspec validate --all --strict',
    'git diff --check',
    'existing open archive pull request',
    'Do not create a duplicate',
    'Record the archive outcome',
  ]) assert.ok(body.includes(expected), `missing archive validation contract: ${expected}`)
})

test('archive workflow reuses the shared engine without inheriting review publishing behavior', () => {
  const { config, body } = source()
  assert.ok(config.imports.includes('shared/deepseek-engine.md'))
  assert.equal(config.engine, undefined)
  assert.ok(body.includes('OpenSpec: n/a'))
  assert.ok(body.includes('merged'))
  assert.ok(!body.includes('submit_pull_request_review'))
  assert.ok(!body.includes('merge_pull_request'))
})
