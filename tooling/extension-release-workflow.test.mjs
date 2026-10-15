import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('rulesync'))('js-yaml')
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const workflow = load(read('.github/workflows/extension-release.yml'))

test('release uses complete branch pushes, immutable checkouts and non-canceling branch queues', () => {
  assert.deepEqual(workflow.on, { push: { branches: ['dev', 'beta', 'main'] } })
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.deepEqual(workflow.concurrency, { group: 'extension-release-${{ github.ref }}', 'cancel-in-progress': false, queue: 'max' })
  assert.equal(workflow.jobs.detect.if, "github.repository == 'slax-lab/slax-reader'")
  assert.equal(workflow.jobs.build.if, "needs.detect.outputs.eligible == 'true'")
  assert.equal(workflow.jobs.build.environment, '${{ github.ref_name }}')
  for (const job of Object.values(workflow.jobs)) {
    const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'))
    assert.deepEqual(checkout.with, { ref: '${{ github.sha }}', 'fetch-depth': 0, 'persist-credentials': false })
    assert.equal(job.steps.find(step => step.uses?.startsWith('actions/setup-node@')).with['node-version'], '24.15.0')
  }
})

test('build has public inputs and no write token; only verified distribution can write releases', () => {
  const { detect, build, publish } = workflow.jobs
  assert.deepEqual(detect.permissions, { contents: 'read', 'pull-requests': 'read' })
  assert.equal(build.permissions, undefined)
  assert.deepEqual(publish.permissions, { contents: 'write', 'pull-requests': 'read' })
  assert.deepEqual(build.steps.find(step => step.run?.includes(' prepare ')).env, { EXTENSION_BUILD_CONFIG: '${{ vars.EXTENSION_BUILD_CONFIG }}' })
  assert.ok(build.steps.some(step => step.run === 'pnpm install --frozen-lockfile'))
  assert.ok(build.steps.some(step => step.run?.includes(' verify ')))
  assert.ok(!JSON.stringify(build).includes('GH_TOKEN'))
  assert.ok(!JSON.stringify(workflow).match(/secrets\.|id-token|npm publish|chrome-webstore|edge-addons/))
  const upload = build.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))
  assert.equal(upload.with.name, 'extension-release-${{ github.sha }}-${{ github.ref_name }}-${{ github.run_attempt }}')
  const download = publish.steps.find(step => step.uses?.startsWith('actions/download-artifact@'))
  assert.equal(download.with['artifact-ids'], '${{ needs.build.outputs.artifact_id }}')
  assert.equal(download.with.name, undefined)
  assert.equal(build.outputs.artifact_id, '${{ steps.release_artifact.outputs.artifact-id }}')
  assert.ok(!publish.steps.some(step => step.run?.includes('install')))
  assert.equal(publish.steps.at(-1).env.GH_TOKEN, '${{ github.token }}')
})

test('PR validation includes workflow, ZIP inspector and focused root tests', () => {
  const ci = load(read('.github/workflows/frontend-ci.yml'))
  for (const event of ['pull_request', 'push']) for (const path of ['.github/workflows/extension-release.yml', 'tooling/extension-release-archive.py']) assert.ok(ci.on[event].paths.includes(path))
  assert.ok(ci.jobs.check.steps.some(step => step.run === 'pnpm test:extension-tooling'))
  const scripts = JSON.parse(read('package.json')).scripts
  for (const suite of ['extension-release', 'extension-release-source', 'extension-release-package', 'extension-release-workflow']) assert.ok(scripts['test:extension-tooling'].includes(`tooling/${suite}.test.mjs`))
})
