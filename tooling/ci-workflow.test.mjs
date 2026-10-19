import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { selectScopes, scopeNames } from './ci-scope.mjs'

const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('rulesync'))('js-yaml')
const validationWorkflows = ['frontend-ci', 'api-ci', 'mobile-ci', 'cli-ci', 'tooling-ci', 'agent-config']
const workflow = name => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'))
const evaluate = (expression, context) => {
  const values = { inputs: { full_validation: false }, cancelled: () => false, ...context }
  return Function(...Object.keys(values), `return (${expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '')})`)(...Object.values(values))
}
const needs = paths => ({ changes: { result: 'success', outputs: Object.fromEntries(Object.entries(selectScopes(paths).scopes).map(([k, v]) => [k, String(v)])) } })
const group = (w, github) => w.concurrency.group.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression) => evaluate(expression, { github }))
const assertValidationTriggers = w => {
  assert.deepEqual(Object.keys(w.on).sort(), ['pull_request', 'workflow_call'])
  assert.equal(w.on.pull_request, null)
  assert.equal(w.on.workflow_call.inputs.full_validation.type, 'boolean')
  assert.equal(w.on.workflow_call.inputs.full_validation.default, false)
}

test('new pushes share a cancellation group while other PRs and workflows remain independent', () => {
  const groups = []
  for (const name of validationWorkflows) {
    const w = workflow(name)
    assert.equal(w.concurrency['cancel-in-progress'], true)
    const prGroup = (number, sha, run_id) => group(w, { workflow: w.name, event: { pull_request: { number } }, sha, run_id })
    const first = prGroup(238, 'a'.repeat(40), 1)
    assert.equal(prGroup(238, 'b'.repeat(40), 2), first, name)
    assert.notEqual(prGroup(239, 'b'.repeat(40), 3), first, name)
    groups.push(first)
  }
  assert.equal(new Set(groups).size, groups.length)
})

test('application workflows always detect full PR differences and cancel obsolete read-only runs', () => {
  for (const name of ['frontend-ci', 'api-ci', 'mobile-ci', 'cli-ci', 'tooling-ci']) {
    const w = workflow(name)
    assertValidationTriggers(w)
    assert.equal(w.concurrency['cancel-in-progress'], true)
    assert.match(w.concurrency.group, /pull_request.number/)
    assert.deepEqual(w.permissions, { contents: 'read' })
    const steps = w.jobs.changes.steps
    assert.equal(evaluate(w.jobs.changes.if, {}), true)
    assert.equal(steps[0].with['fetch-depth'], 0)
    assert.equal(steps[0].with['persist-credentials'], false)
    assert.equal(steps[1].uses, './.github/actions/ci-scope')
    assert.ok(!JSON.stringify(steps).includes('pnpm install'))
    for (const job of Object.values(w.jobs).slice(1)) {
      assert.equal(job.needs, 'changes')
      assert.match(job.if, /needs.changes.outputs/)
    }
  }
  const action = load(readFileSync(new URL('../.github/actions/ci-scope/action.yml', import.meta.url), 'utf8'))
  for (const name of scopeNames) assert.equal(action.outputs[name].value, `\${{ steps.detect.outputs.${name} }}`)
  assert.equal(action.runs.steps[0].run, 'node tooling/ci-scope.mjs')
})

test('daily and manual full validation call every read-only suite on dev without publication permissions', () => {
  const w = workflow('full-ci')
  assert.deepEqual(w.on, { schedule: [{ cron: '23 20 * * *' }], workflow_dispatch: null })
  assert.deepEqual(w.permissions, { contents: 'read' })
  assert.equal(w.concurrency['cancel-in-progress'], false)
  assert.equal(evaluate(w.jobs.source.if, { github: { repository: 'slax-lab/slax-reader' } }), true)
  assert.equal(evaluate(w.jobs.source.if, { github: { repository: 'other/fork' } }), false)
  const guard = w.jobs.source.steps[0]
  assert.deepEqual(guard.env, { CI_REF: '${{ github.ref }}' })
  for (const ref of ['refs/heads/dev', 'refs/heads/beta', 'refs/heads/main', 'refs/heads/topic', 'refs/tags/cli-v1.0.0']) {
    const result = spawnSync('bash', ['-e', '-c', guard.run], { env: { ...process.env, CI_REF: ref }, encoding: 'utf8' })
    assert.equal(result.status, ref === 'refs/heads/dev' ? 0 : 1, ref)
    if (result.status !== 0) assert.match(result.stdout, /Full CI runs on dev/)
  }
  const calls = Object.values(w.jobs).filter(job => job.uses)
  assert.deepEqual(calls.map(job => job.uses).sort(), validationWorkflows.map(name => `./.github/workflows/${name}.yml`).sort())
  for (const job of calls) {
    assert.equal(job.needs, 'source')
    assert.deepEqual(job.with, { full_validation: true })
    assert.equal(job.if, undefined)
    assert.equal(job.secrets, undefined)
    assert.equal(job['continue-on-error'], undefined)
    assert.equal(job.permissions, undefined)
  }
})

test('full mode skips detection and enables every scope even when the detector has no outputs', () => {
  const expected = {
    'frontend-ci': ['web', 'extension', 'design'], 'api-ci': ['check'], 'mobile-ci': ['static'],
    'cli-ci': ['check'], 'tooling-ci': ['check', 'cli-release', 'extension-release'],
  }
  const forbiddenOutputs = new Proxy({}, { get() { throw new Error('Full validation consulted the scope detector') } })
  for (const outputs of [needs([]).changes.outputs, forbiddenOutputs]) {
    const context = { inputs: { full_validation: true }, needs: { changes: { result: 'skipped', outputs } } }
    for (const [name, selected] of Object.entries(expected)) {
      const w = workflow(name)
      assert.equal(evaluate(w.jobs.changes.if, context), false, name)
      const actual = Object.entries(w.jobs).filter(([id, job]) => id !== 'changes' && evaluate(job.if, context)).map(([id]) => id)
      assert.deepEqual(actual, selected, name)
      for (const id of selected) {
        assert.match(w.jobs[id].if, /!cancelled\(\)/, 'Override the implicit success condition after skipped detection')
        assert.equal(evaluate(w.jobs[id].if, { ...context, cancelled: () => true }), false)
      }
    }
    const guard = workflow('agent-config').jobs.guard
    const steps = { scope: { outputs } }
    assert.equal(evaluate(guard.steps[1].if, { ...context, steps }), false)
    for (const step of guard.steps.slice(2)) assert.equal(evaluate(step.if, { ...context, steps }), true, step.name || step.run || step.uses)
  }
  const front = workflow('frontend-ci').jobs
  for (const command of ['pnpm icons:test', 'pnpm icons:check']) assert.ok(front.web.steps.some(step => step.run === command))
  assert.ok(workflow('mobile-ci').jobs.static.steps.some(step => step.run === 'pnpm mobile -- check'))
  const mobileCheck = readFileSync(new URL('../apps/mobile/tooling/check.mjs', import.meta.url), 'utf8')
  assert.match(mobileCheck, /assets\/verify-baseline\.mjs/)
  assert.match(mobileCheck, /'test'/)
})

test('failed PR detection and cancellation never accept dependent validation', () => {
  for (const name of validationWorkflows.filter(name => name !== 'agent-config')) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const dependencies = needs(['package.json'])
      dependencies.changes.result = result
      for (const [id, job] of Object.entries(workflow(name).jobs)) if (id !== 'changes') assert.equal(evaluate(job.if, { needs: dependencies }), false, `${name}/${id}/${result}`)
    }
    for (const [id, job] of Object.entries(workflow(name).jobs)) if (id !== 'changes') assert.equal(evaluate(job.if, { needs: needs(['package.json']), cancelled: () => true }), false, `${name}/${id}`)
  }
})

test('reusable suites sharing a full-validation caller cannot cancel each other or PR validation', () => {
  const caller = { workflow: 'Full CI', event: { pull_request: {} }, run_id: 123 }
  const groups = validationWorkflows.map(name => group(workflow(name), caller))
  assert.equal(new Set(groups).size, validationWorkflows.length)
  assert.ok(!groups.includes(group(workflow('full-ci'), { ...caller, ref: 'refs/heads/dev' })))
  for (const name of validationWorkflows) {
    const w = workflow(name)
    assert.notEqual(group(w, caller), group(w, { ...caller, run_id: 124 }))
    assert.notEqual(group(w, caller), group(w, { workflow: w.name, event: { pull_request: { number: 238 } }, run_id: 123 }))
  }
})

test('actual frontend and tooling job conditions avoid unrelated application work', () => {
  const front = workflow('frontend-ci').jobs
  for (const [path, web, extension] of [['apps/web/page.vue', true, false], ['apps/extension/page.vue', false, true], ['packages/selection/src/index.ts', true, true], ['tooling/cli-release.mjs', false, false], ['docs/design/reference/icon.svg', false, false]]) {
    const context = { needs: needs([path]) }
    assert.equal(evaluate(front.web.if, context), web, path)
    assert.equal(evaluate(front.extension.if, context), extension, path)
  }
  const commands = front.web.steps.map(s => s.run)
  assert.ok(commands.indexOf('pnpm icons:check') < commands.indexOf('pnpm --filter @apps/slax-reader-dweb typecheck'))
  const tooling = workflow('tooling-ci').jobs
  assert.equal(evaluate(tooling['cli-release'].if, { needs: needs(['tooling/cli-release.mjs']) }), true)
  assert.equal(evaluate(tooling['extension-release'].if, { needs: needs(['apps/web/env.schema.ts']) }), true)
  assert.equal(evaluate(workflow('api-ci').jobs.check.if, { needs: needs(['deploy/mobile/tooling.cjs']) }), false)
  const mobile = workflow('mobile-ci').jobs
  assert.equal(evaluate(mobile.static.if, { needs: needs(['docs/mobile/README.md']) }), false)
  assert.equal(mobile.evidence, undefined)
})

test('required configuration context performs detection directly and gates all expensive steps', () => {
  const w = workflow('agent-config'), job = w.jobs.guard
  assert.equal(job.name, 'agent-config drift check')
  assertValidationTriggers(w)
  assert.equal(job.needs, undefined)
  assert.equal(job.if, undefined)
  const scopes = paths => ({ steps: { scope: { outputs: Object.fromEntries(Object.entries(selectScopes(paths).scopes).map(([k, v]) => [k, String(v)])) } } })
  assert.equal(job.steps[1].uses, './.github/actions/ci-scope')
  for (const step of job.steps.slice(2)) {
    assert.ok(step.if)
    assert.equal(evaluate(step.if, scopes(['apps/web/page.vue'])), false, step.name || step.run || step.uses)
  }
  for (const [path, name] of [['.rulesync/rules/overview.md', 'rulesync drift check'], ['openspec/changes/a/tasks.md', 'openspec validate'], ['.github/workflows/shared/pr-review-core.md', 'gh-aw compile drift check']]) assert.equal(evaluate(job.steps.find(s => s.name === name).if, scopes([path])), true)
  const gh = job.steps.find(s => s.name === 'gh-aw compile drift check')
  assert.match(gh.run, /compile --strict --purge --no-check-update/)
  assert.match(gh.run, /exit 1/)
})

test('CLI retains compatibility suites and publication/deployment retain their own safety checks', () => {
  const cli = workflow('cli-ci').jobs.check
  assert.deepEqual(cli.strategy.matrix.node, ['22.22.2', '24.15.0'])
  for (const cmd of ['pnpm cli -- typecheck', 'pnpm cli -- test', 'pnpm cli -- test:package']) assert.ok(cli.steps.some(s => s.run === cmd))
  for (const cmd of ['pnpm test:preflight', 'pnpm test:cli-tooling']) assert.ok(!cli.steps.some(s => s.run === cmd))
  const tooling = workflow('tooling-ci').jobs
  assert.ok(tooling.check.steps.some(s => s.run === 'pnpm test:preflight'))
  assert.ok(tooling['cli-release'].steps.some(s => s.run === 'pnpm test:cli-tooling'))
  assert.ok(tooling['extension-release'].steps.some(s => s.run === 'pnpm test:extension-tooling'))
  assert.equal(evaluate(tooling['extension-release'].if, { needs: needs(['.github/workflows/extension-release.yml']) }), true)
  assert.equal(evaluate(tooling['extension-release'].if, { needs: needs(['apps/web/page.vue']) }), false)
  assert.equal(tooling['cli-release'].steps.find(s => s.uses?.startsWith('actions/setup-node@')).with['node-version'], '24.15.0')
  const release = workflow('cli-release')
  assert.deepEqual(release.on.push.branches, ['dev', 'beta', 'main'])
  assert.equal(release.concurrency['cancel-in-progress'], false)
  assert.equal(workflow('extension-release').concurrency['cancel-in-progress'], false)
  for (const name of ['api-deploy', 'web-deploy']) assert.equal(workflow(name).jobs.deploy.concurrency['cancel-in-progress'], false)
})
