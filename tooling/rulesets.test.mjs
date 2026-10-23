import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyRulesets,
  compareRulesets,
  describeGhFailure,
  fetchRulesets,
  normalizeRuleset,
  normalizeRulesets,
  parseArguments,
  renderDrift,
  validateRulesets
} from './rulesets.mjs'

const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('rulesync'))('js-yaml')
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const expectedPath = new URL('../.github/rulesets.expected.json', import.meta.url)
const workflowPath = new URL('../.github/workflows/ruleset-drift.yml', import.meta.url)
const clone = value => JSON.parse(JSON.stringify(value))

const liveDev = () => ({
  id: 4100518,
  name: 'release-branches',
  target: 'branch',
  source_type: 'Repository',
  source: 'slax-lab/slax-reader',
  enforcement: 'active',
  conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH', 'refs/heads/dev'] } },
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    {
      type: 'pull_request',
      parameters: {
        allowed_merge_methods: ['squash', 'rebase', 'merge'],
        dismiss_stale_reviews_on_push: true,
        dismissal_restriction: { allowed_actors: [], enabled: false },
        require_code_owner_review: true,
        require_extra_approval_for_unattributed_changes: true,
        require_last_push_approval: true,
        required_approving_review_count: 1,
        required_review_thread_resolution: false,
        required_reviewers: []
      }
    },
    {
      type: 'required_status_checks',
      parameters: {
        do_not_enforce_on_create: false,
        required_status_checks: [
          { context: 'agent-config drift check', integration_id: 15368 },
          { context: 'PR review gate', integration_id: 15368 },
          { context: 'Web CI gate', integration_id: 15368 }
        ],
        strict_required_status_checks_policy: false
      }
    }
  ],
  node_id: 'RRS_fixture',
  created_at: '2025-03-11T09:58:39.925Z',
  updated_at: '2026-10-12T07:32:44.647Z',
  bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }],
  current_user_can_bypass: 'pull_requests_only',
  _links: { self: { href: 'https://api.github.com/repos/example/reader/rulesets/4100518' }, html: { href: 'https://github.com/example/reader/rules/4100518' } }
})

const codifiedDev = () => normalizeRuleset(liveDev())

const loadExpected = () => validateRulesets(normalizeRulesets(JSON.parse(readFileSync(expectedPath, 'utf8'))))
const ruleOf = (ruleset, type) => ruleset.rules.find(rule => rule.type === type)
const contextsOf = ruleset => ruleOf(ruleset, 'required_status_checks').parameters.required_status_checks.map(check => check.context)

test('normalizes server metadata away and orders keys and set-like arrays canonically', () => {
  const normalized = normalizeRuleset(liveDev())
  assert.deepEqual(Object.keys(normalized), ['bypass_actors', 'conditions', 'enforcement', 'name', 'rules', 'target'])
  for (const field of ['id', 'node_id', 'source', 'source_type', 'created_at', 'updated_at', '_links', 'current_user_can_bypass']) assert.ok(!(field in normalized), field)
  assert.deepEqual(Object.keys(normalized.conditions.ref_name), ['exclude', 'include'])
  assert.deepEqual(normalized.rules.map(rule => rule.type), ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks'])
  assert.deepEqual(ruleOf(normalized, 'pull_request').parameters.allowed_merge_methods, ['merge', 'rebase', 'squash'])
  assert.deepEqual(contextsOf(normalized), ['PR review gate', 'Web CI gate', 'agent-config drift check'])
  assert.equal(ruleOf(normalized, 'required_status_checks').parameters.required_status_checks[0].integration_id, 15368)
  assert.deepEqual(normalized.bypass_actors, [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }])
})

test('key and array ordering never produce false drift', () => {
  const reordered = clone(liveDev())
  reordered.rules.reverse()
  reordered.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks.reverse()
  reordered.rules.find(rule => rule.type === 'pull_request').parameters.allowed_merge_methods.reverse()
  reordered.conditions.ref_name.include.reverse()
  reordered.conditions.ref_name.exclude = []
  reordered.bypass_actors.reverse()
  const expected = normalizeRulesets([liveDev()])
  const actual = normalizeRulesets([reordered])
  assert.deepEqual(compareRulesets(expected, actual), [])
})

test('reports field, rule, and context drift with actionable paths', () => {
  const expected = normalizeRulesets([liveDev()])
  const changed = clone(liveDev())
  changed.enforcement = 'disabled'
  changed.rules = changed.rules.filter(rule => rule.type !== 'required_status_checks')
  const checks = changed.rules.find(rule => rule.type === 'pull_request').parameters
  checks.required_approving_review_count = 0
  checks.allowed_merge_methods = ['merge']
  changed.rules.push({ type: 'required_signatures' })
  const drift = compareRulesets(expected, [normalizeRuleset(changed)])
  assert.equal(drift.length, 1)
  assert.equal(drift[0].name, 'release-branches')
  assert.equal(drift[0].kind, 'changed')
  const changes = drift[0].changes
  assert.ok(changes.some(change => change.path === 'enforcement' && change.kind === 'changed' && change.expected === 'active' && change.actual === 'disabled'))
  assert.ok(changes.some(change => change.path === 'rules[required_status_checks]' && change.kind === 'missing'))
  assert.ok(changes.some(change => change.path === 'rules[required_signatures]' && change.kind === 'unexpected'))
  assert.ok(changes.some(change => change.path === 'rules[pull_request].parameters.required_approving_review_count' && change.kind === 'changed'))
  assert.ok(changes.some(change => change.path === 'rules[pull_request].parameters.allowed_merge_methods[squash]' && change.kind === 'missing'))
  const rendered = renderDrift(drift)
  assert.match(rendered, /## Ruleset drift detected/)
  assert.match(rendered, /### `release-branches`/)
  assert.match(rendered, /expected "active", live "disabled"/)
  assert.match(rendered, /node tooling\/rulesets\.mjs apply/)
})

test('reports missing and unexpected rulesets', () => {
  const expected = normalizeRulesets([liveDev()])
  const extra = normalizeRulesets([{ ...liveDev(), id: 9, name: 'stray-ruleset' }])
  const drift = compareRulesets(expected, extra)
  assert.deepEqual(drift.map(entry => [entry.name, entry.kind]), [['release-branches', 'missing'], ['stray-ruleset', 'unexpected']])
  assert.match(renderDrift(drift), /missing from the live repository/)
  assert.match(renderDrift(drift), /not codified/)
})

test('fetches paginated ruleset lists and every ruleset detail', () => {
  const calls = []
  const runGh = args => {
    calls.push(args)
    if (args.includes('--paginate')) return JSON.stringify([[{ id: 7 }, { id: 9 }]])
    if (args.at(-1).endsWith('/7')) return JSON.stringify({ ...liveDev(), id: 7 })
    if (args.at(-1).endsWith('/9')) return JSON.stringify({ ...liveDev(), id: 9, name: 'release-beta' })
    throw new Error(`unexpected gh call ${args.join(' ')}`)
  }
  const rulesets = fetchRulesets({ repository: 'example/reader', runGh })
  assert.deepEqual(rulesets.map(ruleset => ruleset.name), ['release-branches', 'release-beta'])
  assert.deepEqual(calls, [
    ['api', '--paginate', '--slurp', 'repos/example/reader/rulesets?includes_parents=false'],
    ['api', 'repos/example/reader/rulesets/7'],
    ['api', 'repos/example/reader/rulesets/9']
  ])
})

test('gh failure output carries token renewal guidance only for authentication failures', () => {
  const args = ['api', '--paginate', '--slurp', 'repos/example/reader/rulesets?includes_parents=false']
  for (const detail of ['gh: Bad credentials (HTTP 401)', 'gh: Resource not accessible by personal access token (HTTP 403)']) {
    const message = describeGhFailure(args, detail)
    assert.match(message, /RULESETS_READ_TOKEN/)
    assert.match(message, /Administration read/)
    assert.match(message, /gh auth login/)
  }
  const plain = describeGhFailure(args, 'gh: Not Found (HTTP 404)')
  assert.equal(plain, `gh api --paginate --slurp failed: gh: Not Found (HTTP 404)`)
  assert.doesNotMatch(plain, /RULESETS_READ_TOKEN/)
})

test('apply leaves matching rulesets unchanged, updates drift, creates missing ones, and warns about extras', () => {
  const unchangedCalls = []
  const unchanged = applyRulesets({
    expected: normalizeRulesets([liveDev()]),
    live: [clone(liveDev())],
    repository: 'example/reader',
    runGh: args => unchangedCalls.push(args)
  })
  assert.deepEqual(unchanged, [{ action: 'unchanged', name: 'release-branches' }])
  assert.deepEqual(unchangedCalls, [])

  const updateCalls = []
  const codified = codifiedDev()
  codified.enforcement = 'disabled'
  const updated = applyRulesets({
    expected: [codified],
    live: [clone(liveDev())],
    repository: 'example/reader',
    runGh: (args, options) => updateCalls.push({ args, options })
  })
  assert.deepEqual(updated, [{ action: 'updated', name: 'release-branches' }])
  assert.deepEqual(updateCalls[0].args, ['api', '--method', 'PUT', 'repos/example/reader/rulesets/4100518', '--input', '-'])
  assert.deepEqual(JSON.parse(updateCalls[0].options.input), codified)

  const createCalls = []
  const beta = normalizeRulesets([{ ...liveDev(), id: 10, name: 'release-beta' }])[0]
  const created = applyRulesets({
    expected: [beta],
    live: [clone(liveDev())],
    repository: 'example/reader',
    runGh: (args, options) => createCalls.push({ args, options })
  })
  assert.deepEqual(created, [{ action: 'created', name: 'release-beta' }])
  assert.deepEqual(createCalls[0].args, ['api', '--method', 'POST', 'repos/example/reader/rulesets', '--input', '-'])
  assert.deepEqual(JSON.parse(createCalls[0].options.input), beta)

  const messages = []
  applyRulesets({
    expected: [codifiedDev()],
    live: [clone(liveDev()), { ...clone(liveDev()), id: 99, name: 'stray-ruleset' }],
    repository: 'example/reader',
    runGh: () => {},
    log: message => messages.push(message)
  })
  assert.match(messages.join('\n'), /live ruleset stray-ruleset is not codified/)
})

test('apply refuses to run under CI before touching the API', t => {
  const directory = mkdtempSync(join(tmpdir(), 'ruleset-apply-ci-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const bin = join(directory, 'bin')
  mkdirSync(bin)
  const marker = join(directory, 'gh-called')
  writeFileSync(join(bin, 'gh'), `#!/bin/bash\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 })
  const result = spawnSync(process.execPath, ['tooling/rulesets.mjs', 'apply'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', GH_TOKEN: 'invalid', GITHUB_REPOSITORY: 'example/reader', PATH: `${bin}:${process.env.PATH}` }
  })
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.match(result.stderr, /refusing to run under CI/)
  assert.notEqual(spawnSync('test', ['-e', marker]).status, 0)
})

test('validates codified state strictly', () => {
  assert.throws(() => validateRulesets([{ ...codifiedDev(), name: 'release-branches' }, { ...codifiedDev(), name: 'release-branches' }]), /duplicate ruleset name/)
  assert.throws(() => validateRulesets([{ ...codifiedDev(), enforcment: 'active' }]), /unsupported field enforcment/)
  assert.throws(() => validateRulesets([{ ...codifiedDev(), target: 'release' }]), /target must be branch or tag/)
  assert.throws(() => validateRulesets([{ ...codifiedDev(), bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'sometimes' }] }]), /bypass_actors/)
})

test('parses CLI options without hiding unknown arguments', () => {
  const parsed = parseArguments(['check', '--repo', 'example/reader', '--file', 'state.json'], '/tmp')
  assert.equal(parsed.mode, 'check')
  assert.equal(parsed.repository, 'example/reader')
  assert.equal(parsed.file, '/tmp/state.json')
  assert.throws(() => parseArguments(['check', '--unknown'], '/tmp'), /unknown argument/)
  assert.throws(() => parseArguments(['check', '--repo'], '/tmp'), /requires a value/)
})

test('codified state matches the per-branch protection contracts', () => {
  const rulesets = loadExpected()
  assert.deepEqual(rulesets.map(ruleset => ruleset.name), ['release-beta', 'release-branches', 'release-main'])
  for (const ruleset of rulesets) {
    assert.equal(ruleset.enforcement, 'active')
    assert.ok(ruleOf(ruleset, 'deletion'))
    assert.ok(ruleOf(ruleset, 'non_fast_forward'))
    assert.ok(ruleOf(ruleset, 'pull_request'))
    assert.deepEqual(ruleset.bypass_actors, [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }])
  }

  const [beta, dev, main] = rulesets
  assert.deepEqual(dev.conditions.ref_name.include, ['refs/heads/dev', '~DEFAULT_BRANCH'])
  assert.deepEqual(beta.conditions.ref_name.include, ['refs/heads/beta'])
  assert.deepEqual(main.conditions.ref_name.include, ['refs/heads/main'])

  assert.deepEqual(contextsOf(dev), ['API CI gate', 'CLI CI gate', 'Extension CI gate', 'Mobile CI gate', 'PR review gate', 'Tooling CI gate', 'Web CI gate', 'agent-config drift check'])
  assert.deepEqual(contextsOf(beta), ['API CI gate', 'CLI CI gate', 'Extension CI gate', 'Mobile CI gate', 'Tooling CI gate', 'Web CI gate', 'promotion integrity'])
  assert.deepEqual(contextsOf(main), ['promotion integrity'])

  assert.deepEqual(ruleOf(dev, 'pull_request').parameters.allowed_merge_methods, ['merge', 'rebase', 'squash'])
  assert.equal(ruleOf(dev, 'pull_request').parameters.required_approving_review_count, 1)
  for (const ruleset of [beta, main]) {
    assert.deepEqual(ruleOf(ruleset, 'pull_request').parameters.allowed_merge_methods, ['merge'])
    assert.equal(ruleOf(ruleset, 'pull_request').parameters.required_approving_review_count, 0)
  }
})

test('drift workflow is scheduled detection that never applies mutations', () => {
  const workflow = load(readFileSync(workflowPath, 'utf8'))
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch'])
  assert.deepEqual(workflow.on.schedule, [{ cron: '17 3 * * *' }])
  assert.equal(workflow.on.workflow_dispatch, null)
  assert.deepEqual(workflow.permissions, { contents: 'read', issues: 'write' })
  assert.equal(workflow.concurrency['cancel-in-progress'], false)

  const job = workflow.jobs.check
  assert.equal(job.if, undefined)
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.uses, 'actions/checkout@v4')
  assert.equal(checkout.with['persist-credentials'], false)
  const setupNode = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'))
  assert.equal(setupNode.uses, 'actions/setup-node@v4')
  assert.equal(setupNode.with['node-version'], '22.22.2')
  const check = job.steps.find(step => step.id === 'check')
  assert.equal(check['continue-on-error'], true)
  assert.equal(check.env.GH_TOKEN, '${{ secrets.RULESETS_READ_TOKEN }}')
  assert.match(check.run, /node tooling\/rulesets\.mjs check/)
  const issue = job.steps.find(step => step.name === 'Open or update the tracking issue')
  assert.equal(issue.if, "steps.check.outcome == 'failure'")
  assert.equal(issue.env.GH_TOKEN, '${{ github.token }}')
  assert.match(issue.run, /label='ruleset-drift'/)
  assert.match(issue.run, /gh label create "\$label"/)
  assert.match(issue.run, /gh issue list/)
  assert.match(issue.run, /--label "\$label"/)
  assert.match(issue.run, /gh issue create/)
  assert.match(issue.run, /gh issue edit/)
  assert.doesNotMatch(JSON.stringify(workflow), /rulesets\.mjs apply/)
  for (const step of job.steps.filter(step => step.run)) {
    const syntax = spawnSync('/bin/bash', ['-n'], { input: step.run, encoding: 'utf8' })
    assert.equal(syntax.status, 0, syntax.stderr)
  }
})

const runScript = (script, env) => spawnSync('/bin/bash', ['--noprofile', '--norc', '-Eeuo', 'pipefail', '-c', script], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } })

test('drift workflow reports a missing token instead of running the check', t => {
  const directory = mkdtempSync(join(tmpdir(), 'ruleset-drift-token-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const report = join(directory, 'report.md')
  const bin = join(directory, 'bin')
  mkdirSync(bin)
  const marker = join(directory, 'node-called')
  writeFileSync(join(bin, 'node'), `#!/bin/bash\ntouch "${marker}"\nexit 0\n`, { mode: 0o755 })
  const workflow = load(readFileSync(workflowPath, 'utf8'))
  const check = workflow.jobs.check.steps.find(step => step.id === 'check')
  const result = runScript(check.run, { GH_TOKEN: '', REPORT: report, PATH: `${bin}:${process.env.PATH}` })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(readFileSync(report, 'utf8'), /Ruleset drift check could not run[\s\S]*RULESETS_READ_TOKEN/)
  assert.notEqual(spawnSync('test', ['-e', marker]).status, 0)
})

test('drift workflow captures check output and exit status', t => {
  const directory = mkdtempSync(join(tmpdir(), 'ruleset-drift-check-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const report = join(directory, 'report.md')
  const bin = join(directory, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'node'), '#!/bin/bash\nprintf "## Ruleset drift detected\\n"\nexit 1\n', { mode: 0o755 })
  const workflow = load(readFileSync(workflowPath, 'utf8'))
  const check = workflow.jobs.check.steps.find(step => step.id === 'check')
  const result = runScript(check.run, { GH_TOKEN: 'fixture-token', REPORT: report, PATH: `${bin}:${process.env.PATH}` })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /## Ruleset drift detected/)
  assert.match(readFileSync(report, 'utf8'), /## Ruleset drift detected/)
})

test('drift workflow edits one open tracking issue, or creates it when absent', t => {
  const directory = mkdtempSync(join(tmpdir(), 'ruleset-drift-issue-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const report = join(directory, 'report.md')
  const log = join(directory, 'gh.log')
  const bin = join(directory, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${log}"\nif [ "$1" = issue ] && [ "$2" = list ]; then printf '%s\\n' "\${FIXTURE_EXISTING}"; fi\nexit 0\n`, { mode: 0o755 })
  const workflow = load(readFileSync(workflowPath, 'utf8'))
  const issue = workflow.jobs.check.steps.find(step => step.name === 'Open or update the tracking issue')
  const env = { REPORT: report, GH_TOKEN: 'fixture-token', GITHUB_REPOSITORY: 'example/reader', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '12345', PATH: `${bin}:${process.env.PATH}` }

  writeFileSync(report, '## Ruleset drift detected\n\nfixture\n')
  let result = runScript(issue.run, { ...env, FIXTURE_EXISTING: '42' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  let calls = readFileSync(log, 'utf8')
  assert.match(calls, /issue edit 42 --repo example\/reader --body-file/)
  assert.match(readFileSync(report, 'utf8'), /Scheduled check: https:\/\/github\.com\/example\/reader\/actions\/runs\/12345/)

  writeFileSync(log, '')
  writeFileSync(report, '## Ruleset drift detected\n\nfixture\n')
  result = runScript(issue.run, { ...env, FIXTURE_EXISTING: '' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  calls = readFileSync(log, 'utf8')
  assert.match(calls, /issue create --repo example\/reader --title Ruleset drift check failed --label ruleset-drift --body-file/)
  assert.doesNotMatch(calls, /issue edit/)
})
