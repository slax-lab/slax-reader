import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { selectScopes, scopeNames } from './ci-scope.mjs'
import { compareMobileVersion, validateMobileAppConfig } from './mobile-eas-release.mjs'

const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('rulesync'))('js-yaml')
const validationWorkflows = ['frontend-ci', 'api-ci', 'mobile-ci', 'cli-ci', 'tooling-ci', 'agent-config']
// Terminal gate job ids and exact names per application workflow: the names are
// required status contexts in the dev and beta rulesets, so renaming one strands
// the context at "Expected" until the ruleset is updated.
const gateContracts = {
  'frontend-ci': { 'web-gate': 'Web CI gate', 'extension-gate': 'Extension CI gate' },
  'api-ci': { 'api-gate': 'API CI gate' },
  'mobile-ci': { 'mobile-gate': 'Mobile CI gate' },
  'cli-ci': { 'cli-gate': 'CLI CI gate' },
  'tooling-ci': { 'tooling-gate': 'Tooling CI gate' },
}
const applicationWorkflows = Object.keys(gateContracts)
const gateIds = name => Object.keys(gateContracts[name])
const workflow = name => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'))
const evaluate = (expression, context) => {
  const values = { inputs: { full_validation: false }, cancelled: () => false, always: () => true, ...context }
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
  for (const name of applicationWorkflows) {
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
    for (const [id, job] of Object.entries(w.jobs)) {
      if (id === 'changes' || gateIds(name).includes(id)) continue
      assert.equal(job.needs, 'changes')
      assert.match(job.if, /needs.changes.outputs/)
    }
  }
  const action = load(readFileSync(new URL('../.github/actions/ci-scope/action.yml', import.meta.url), 'utf8'))
  for (const name of scopeNames) assert.equal(action.outputs[name].value, `\${{ steps.detect.outputs.${name} }}`)
  assert.equal(action.runs.steps[0].run, 'node tooling/ci-scope.mjs')
})

test('suite gate jobs expose the required contexts and fail closed unless every needed job passed or was skipped', () => {
  const names = []
  for (const [name, contracts] of Object.entries(gateContracts)) {
    const w = workflow(name)
    const suiteJobs = Object.keys(w.jobs).filter(id => !gateIds(name).includes(id))
    for (const [id, expected] of Object.entries(contracts)) {
      const job = w.jobs[id]
      assert.ok(job, `${name}/${id} must exist`)
      assert.equal(job.name, expected)
      assert.equal(job.if, 'always()')
      assert.equal(evaluate(job.if, { cancelled: () => true }), true, `${name}/${id} must run after a cancel`)
      assert.deepEqual([...job.needs].sort(), suiteJobs.filter(other => other !== id).sort(), `${name}/${id} must need every suite job`)
      assert.equal(job['runs-on'], 'ubuntu-latest')
      assert.equal(job.steps.length, 1)
      const [step] = job.steps
      assert.deepEqual(step.env, { RESULTS: "${{ join(needs.*.result, ' ') }}" })
      const status = results => spawnSync('bash', ['-e', '-c', step.run], { env: { ...process.env, RESULTS: results }, encoding: 'utf8' }).status
      assert.equal(status('success skipped success'), 0, `${name}/${id} accepts skipped scopes`)
      assert.equal(status('skipped skipped'), 0, `${name}/${id} accepts an unselected suite`)
      assert.equal(status('success failure success'), 1, `${name}/${id} rejects a failed job`)
      assert.equal(status('cancelled'), 1, `${name}/${id} fails closed on cancellation`)
      names.push(job.name)
    }
  }
  assert.deepEqual(names.sort(), ['API CI gate', 'CLI CI gate', 'Extension CI gate', 'Mobile CI gate', 'Tooling CI gate', 'Web CI gate'])
  assert.equal(new Set(names).size, names.length, 'required contexts must be unique across workflows')
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
      const actual = Object.entries(w.jobs).filter(([id, job]) => id !== 'changes' && !gateIds(name).includes(id) && evaluate(job.if, context)).map(([id]) => id)
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
  for (const name of applicationWorkflows) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const dependencies = needs(['package.json'])
      dependencies.changes.result = result
      for (const [id, job] of Object.entries(workflow(name).jobs)) if (id !== 'changes' && !gateIds(name).includes(id)) assert.equal(evaluate(job.if, { needs: dependencies }), false, `${name}/${id}/${result}`)
    }
    for (const [id, job] of Object.entries(workflow(name).jobs)) if (id !== 'changes' && !gateIds(name).includes(id)) assert.equal(evaluate(job.if, { needs: needs(['package.json']), cancelled: () => true }), false, `${name}/${id}`)
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
  assert.deepEqual(cli.strategy.matrix.node, ['22.22.2', '24.15.0', '26.12.1'])
  for (const cmd of ['pnpm cli -- typecheck', 'pnpm cli -- test', 'pnpm cli -- test:package']) assert.ok(cli.steps.some(s => s.run === cmd))
  for (const cmd of ['pnpm test:preflight', 'pnpm test:cli-tooling']) assert.ok(!cli.steps.some(s => s.run === cmd))
  const tooling = workflow('tooling-ci').jobs
  assert.deepEqual(tooling.check.strategy.matrix.node, ['22.22.2', '26.12.1'])
  assert.ok(tooling.check.steps.some(s => s.run === 'pnpm test:preflight'))
  for (const job of [cli, tooling.check]) {
    assert.equal(job.strategy['fail-fast'], false)
    assert.equal(job.steps.find(s => s.uses?.startsWith('actions/setup-node@')).with['node-version'], '${{ matrix.node }}')
  }
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

test('the API deploy runs migration release evidence after the superseded check and before any remote access', () => {
  const w = workflow('api-deploy')
  assert.deepEqual(w.permissions, { actions: 'read', contents: 'read', deployments: 'read', 'pull-requests': 'read' })
  assert.ok(w.on.pull_request_target.paths.includes('tooling/migration-release-evidence.mjs'))
  const steps = w.jobs.deploy.steps
  const checkout = steps.find(step => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with['fetch-depth'], 0)
  const current = steps.findIndex(step => step.name === 'Check the branch before deployment')
  const preflight = steps.findIndex(step => step.name === 'Check migration release evidence')
  const firewall = steps.findIndex(step => step.name === 'Allow the runner through the existing firewall')
  const tunnel = steps.findIndex(step => step.name === 'Open the database Tunnel')
  assert.ok(current >= 0 && preflight > current && firewall > preflight && tunnel > firewall, steps.map(step => step.name ?? step.uses ?? step.run).join(','))
  const step = steps[preflight]
  assert.equal(step.if, "steps.release.outputs.current == 'true'")
  assert.equal(step.run, 'node tooling/migration-release-evidence.mjs deploy')
  assert.equal(step.env.GH_TOKEN, '${{ github.token }}')
  assert.equal(step.env.PR_HEAD_REF, '${{ github.event.pull_request.head.ref }}')
  assert.match(steps[current].run, /tooling\/migration-release-evidence\.mjs/)
})

test('mobile EAS release preflight requires an increasing build with consistent metadata', () => {
  const base = {version: '1.0.25', buildNumber: 771, previousBuildNumber: 770}
  assert.deepEqual(compareMobileVersion(base, base), {changed: false, errors: []})
  assert.deepEqual(compareMobileVersion(base, {...base, buildNumber: 772, previousBuildNumber: 771}), {changed: true, errors: []})
  assert.match(compareMobileVersion(base, {...base, version: '1.0.26', previousBuildNumber: 771}).errors.join('\n'), /buildNumber must increase/)
  assert.match(compareMobileVersion(base, {...base, buildNumber: 770, previousBuildNumber: 769}).errors.join('\n'), /buildNumber must increase/)
  assert.match(compareMobileVersion(base, {...base, buildNumber: 772, previousBuildNumber: 772}).errors.join('\n'), /previousBuildNumber/)
  assert.match(compareMobileVersion(base, {...base, version: '1.0.24', buildNumber: 772, previousBuildNumber: 771}).errors.join('\n'), /must not decrease/)
})

test('mobile EAS preflight reads declared platforms and the SlaxShare target, not arbitrary substrings', () => {
  assert.deepEqual(validateMobileAppConfig(`
    platforms: ['ios', 'android'],
    extra: { eas: { build: { experimental: { ios: {
      appExtensions: [{ targetName: 'SlaxShare', bundleIdentifier: 'app.slax.reader.share' }],
    } } } } },
  `), [])
  assert.match(validateMobileAppConfig(`
    platforms: ['ios'],
    extra: { eas: { build: { experimental: { ios: {
      appExtensions: [{ targetName: 'OtherExtension' }],
    } } } } },
  `).join('\n'), /android/)
  assert.match(validateMobileAppConfig(`
    platforms: ['ios', 'android'],
    extra: { eas: { build: { experimental: { ios: {
      appExtensions: [{ targetName: 'OtherExtension' }],
    } } } } },
  `).join('\n'), /SlaxShare/)
})

test('mobile EAS workflow gates the cloud builds on preflight and Mobile CI, then auto-submits', () => {
  const w = workflow('mobile-eas-build')
  assert.deepEqual(w.on.push.branches, ['dev'])
  assert.match(w.concurrency.group, /github\.sha/)
  assert.equal(w.jobs.preflight.outputs.changed, '${{ steps.check.outputs.changed }}')
  assert.equal(w.jobs.preflight.steps[0].with['fetch-depth'], 0)
  const check = w.jobs.preflight.steps.find(step => step.id === 'check')
  assert.equal(check.run, 'node tooling/mobile-eas-release.mjs')
  assert.equal(w.jobs.mobile.uses, './.github/workflows/mobile-ci.yml')
  assert.deepEqual(w.jobs.mobile.with, {full_validation: true})
  assert.match(w.jobs.mobile.if, /needs\.preflight\.outputs\.changed == 'true'/)
  assert.deepEqual(w.jobs.eas.needs, ['preflight', 'mobile'])
  assert.match(w.jobs.eas.if, /needs\.preflight\.outputs\.changed == 'true'/)
  assert.match(w.jobs.eas.if, /needs\.mobile\.result == 'success'/)
  const build = w.jobs.eas.steps.find(step => step.run?.includes('eas build'))
  assert.match(build.run, /--platform all/)
  assert.doesNotMatch(build.run, /--platform ios/)
  assert.match(build.run, /--no-wait/)
  assert.match(build.run, /--profile production/)
  assert.match(build.run, /--auto-submit(?!-with-profile)/)
  assert.equal(build['working-directory'], 'apps/mobile')
  assert.equal(w.jobs.eas.permissions, undefined)
})
