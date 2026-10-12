import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('rulesync'))('js-yaml')
const workflow = load(readFileSync(new URL('../.github/workflows/web-deploy.yml', import.meta.url), 'utf8'))
const job = workflow.jobs.deploy
const freshness = job.steps.find(step => step.id === 'release')

function evaluate(expression, github) {
  return Function('github', `return (${expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '')})`)(github)
}

function event(branch, merged = true) {
  return { event_name: 'pull_request_target', repository: 'example/reader', event: { action: 'closed', pull_request: { merged, merge_commit_sha: 'a'.repeat(40), base: { ref: branch, repo: { full_name: 'example/reader' } } } } }
}

test('release accepts only merged pull requests and selects one protected Environment', () => {
  assert.deepEqual(Object.keys(workflow.on), ['pull_request_target'])
  assert.deepEqual(workflow.on.pull_request_target.types, ['closed'])
  assert.deepEqual(workflow.on.pull_request_target.branches, ['dev', 'beta', 'main'])
  for (const [branch, environment] of [['dev', 'dev'], ['beta', 'beta'], ['main', 'prod']]) {
    assert.equal(evaluate(job.if, event(branch)), true)
    assert.equal(evaluate(job.environment, event(branch)), environment)
    assert.equal(evaluate(job.if, event(branch, false)), false)
  }
  const foreign = event('dev')
  foreign.event.pull_request.base.repo.full_name = 'other/reader'
  assert.equal(evaluate(job.if, foreign), false)
  for (const eventName of ['pull_request', 'push']) {
    assert.equal(evaluate(job.if, { ...event('dev'), event_name: eventName }), false)
  }
  const opened = event('dev')
  opened.event.action = 'opened'
  assert.equal(evaluate(job.if, opened), false)
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.merge_commit_sha }}')
  assert.equal(checkout.with['persist-credentials'], false)
  assert.equal(job.concurrency['cancel-in-progress'], false)
  assert.match(job.concurrency.group, /base\.ref/)
  assert.deepEqual(workflow.permissions, { contents: 'read' })
})

test('only the guarded publish step receives a Cloudflare Secret', () => {
  for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'PAGES_PROJECT_NAME', 'WEB_BUILD_CONFIG']) {
    assert.equal(job.env[key], `\${{ vars.${key} }}`)
  }
  assert.ok(!JSON.stringify(job.env).includes('secrets.'))
  const secretSteps = job.steps.filter(step => JSON.stringify(step).includes('secrets.'))
  assert.equal(secretSteps.length, 1)
  assert.equal(secretSteps[0].run, 'node tooling/web-pages-deploy.mjs deploy')
  assert.equal(secretSteps[0].env.CLOUDFLARE_API_TOKEN, '${{ secrets.CLOUDFLARE_API_TOKEN }}')
  assert.equal(secretSteps[0].if, "steps.release.outputs.current == 'true'")
  assert.ok(job.steps.some(step => step.run === 'pnpm install --frozen-lockfile'))
  assert.ok(job.steps.some(step => step.run === 'node tooling/web-pages-deploy.mjs build'))
})

test('trigger and freshness scopes agree and frontend CI covers release workflow changes', () => {
  const diff = freshness.run.split('changed=$(git diff --name-only')[1].split(')')[0]
  const paths = [...diff.matchAll(/'([^']+)'/g)].map(match => match[1])
  assert.deepEqual(paths.sort(), [...workflow.on.pull_request_target.paths].sort())
  assert.ok(!paths.some(path => path.startsWith('apps/api/') || path.startsWith('apps/extension/') || path.startsWith('docs/')))
  const frontend = load(readFileSync(new URL('../.github/workflows/frontend-ci.yml', import.meta.url), 'utf8'))
  for (const trigger of ['pull_request', 'push']) assert.ok(frontend.on[trigger].paths.includes('.github/workflows/web-deploy.yml'))
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(manifest.scripts['test:preflight'], /tooling\/web-pages-deploy\.test\.mjs/)
  assert.match(manifest.scripts['test:preflight'], /tooling\/web-pages-workflow\.test\.mjs/)
  const syntax = spawnSync('/bin/bash', ['-n'], { input: freshness.run, encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr)
})

test('the actual freshness shell permits unrelated commits but blocks superseded releases and reruns', t => {
  const root = mkdtempSync(join(tmpdir(), 'web-pages-workflow-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git('init', '-q')
  git('config', 'user.email', 'fixture@example.test')
  git('config', 'user.name', 'Fixture')
  git('config', 'commit.gpgsign', 'false')
  git('remote', 'add', 'origin', root)
  const commit = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
    git('add', file)
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  const original = commit('apps/web/fixture.ts', 'initial')
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), '#!/bin/bash\nprintf "%s\\n" "$FIXTURE_TIP"\n', { mode: 0o755 })
  const run = (tip, merge = original, branch = 'dev') => {
    const output = join(root, 'output')
    writeFileSync(output, '')
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-Eeuo', 'pipefail', '-c', freshness.run], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_TIP: tip, TARGET_BRANCH: branch, MERGE_SHA: merge, GITHUB_REPOSITORY: 'example/reader', GITHUB_OUTPUT: output }
    })
    return { ...result, output: readFileSync(output, 'utf8') }
  }
  assert.equal(run(original).output, 'current=true\n')
  const docs = commit('docs/fixture.md', 'unrelated')
  assert.equal(run(docs).output, 'current=true\n')
  const web = commit('apps/web/fixture.ts', 'changed')
  const stale = run(web)
  assert.equal(stale.status, 0, stale.stderr)
  assert.equal(stale.output, 'current=false\n')
  assert.match(stale.stdout, /superseded|newer Web changes/)
  assert.equal(run(web).output, 'current=false\n')
  assert.equal(run(web, web, 'main').output, 'current=true\n')
  assert.notEqual(run(web, original, 'feature/unsafe').status, 0)
  assert.notEqual(run('invalid-sha').status, 0)
})
