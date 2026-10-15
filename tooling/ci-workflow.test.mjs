import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { selectScopes, scopeNames } from './ci-scope.mjs'

const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('rulesync'))('js-yaml')
const workflow = name => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'))
const evaluate = (expression, context) => Function(...Object.keys(context), `return (${expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '')})`)(...Object.values(context))
const needs = paths => ({ changes: { outputs: Object.fromEntries(Object.entries(selectScopes(paths).scopes).map(([k, v]) => [k, String(v)])) } })

test('application workflows always detect full PR differences and cancel obsolete read-only runs', () => {
  for (const name of ['frontend-ci', 'api-ci', 'mobile-ci', 'cli-ci', 'tooling-ci']) {
    const w = workflow(name)
    assert.deepEqual(w.on, { pull_request: null })
    assert.equal(w.concurrency['cancel-in-progress'], true)
    assert.match(w.concurrency.group, /pull_request.number/)
    assert.deepEqual(w.permissions, { contents: 'read' })
    const steps = w.jobs.changes.steps
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
  assert.equal(evaluate(workflow('api-ci').jobs.check.if, { needs: needs(['deploy/mobile/tooling.cjs']) }), false)
  const mobile = workflow('mobile-ci').jobs
  assert.equal(evaluate(mobile.static.if, { needs: needs(['docs/mobile/README.md']) }), false)
  assert.equal(evaluate(mobile.evidence.if, { needs: needs(['docs/mobile/evidence/report.json']) }), true)
  assert.ok(!mobile.evidence.steps.some(s => /bundle|build:/.test(s.run || '')))
})

test('required configuration context performs detection directly and gates all expensive steps', () => {
  const w = workflow('agent-config'), job = w.jobs.guard
  assert.equal(job.name, 'agent-config drift check')
  assert.deepEqual(w.on, { pull_request: null })
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
  assert.equal(tooling['cli-release'].steps.find(s => s.uses?.startsWith('actions/setup-node@')).with['node-version'], '24.15.0')
  const release = workflow('cli-release')
  assert.deepEqual(release.on.push.branches, ['dev', 'beta', 'main'])
  assert.equal(release.concurrency['cancel-in-progress'], false)
  for (const name of ['api-deploy', 'web-deploy']) assert.equal(workflow(name).jobs.deploy.concurrency['cancel-in-progress'], false)
})
