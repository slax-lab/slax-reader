import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../', import.meta.url))

test('actual CLI archives install and execute with dev, beta and stable versions', { timeout: 600000 }, t => {
  const root = mkdtempSync(join(tmpdir(), 'cli-release-consumer-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'tooling'))
  mkdirSync(join(root, 'apps/cli'), { recursive: true })
  mkdirSync(join(root, 'packages/contracts'), { recursive: true })
  for (const name of ['cli-release.mjs', 'cli.mjs', 'pnpm-command.mjs']) copyFileSync(join(source, 'tooling', name), join(root, 'tooling', name))
  copyFileSync(join(source, 'pnpm-workspace.yaml'), join(root, 'pnpm-workspace.yaml'))
  copyFileSync(join(source, 'packages/contracts/package.json'), join(root, 'packages/contracts/package.json'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'release-consumer-fixture', private: true, type: 'module', scripts: { cli: 'node tooling/cli.mjs' } }))
  writeFileSync(join(root, '.gitignore'), 'node_modules\ndist\nartifacts\npush.json\n')
  for (const name of ['package.json', 'tsup.config.ts', 'tsconfig.json', 'LICENSE', 'README.md']) copyFileSync(join(source, 'apps/cli', name), join(root, 'apps/cli', name))
  for (const name of ['src', 'test', 'script']) cpSync(join(source, 'apps/cli', name), join(root, 'apps/cli', name), { recursive: true })
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(source, 'node_modules/.pnpm'), join(root, 'node_modules/.pnpm'), 'dir')
  cpSync(join(source, 'apps/cli/node_modules'), join(root, 'apps/cli/node_modules'), { recursive: true, verbatimSymlinks: true })
  const manifestPath = join(root, 'apps/cli/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'dev')
  git('config', 'user.name', 'Release consumer fixture')
  git('config', 'user.email', 'release@example.test')
  git('config', 'core.hooksPath', '/dev/null')
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '0.0.0' }))
  git('add', '.')
  git('commit', '-m', 'Earlier CLI version')
  const before = git('rev-parse', 'HEAD')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  git('add', 'apps/cli/package.json')
  git('commit', '-m', 'CLI version increase')
  const after = git('rev-parse', 'HEAD')
  const script = join(root, 'tooling/cli-release.mjs')
  for (const branch of ['dev', 'beta', 'main']) {
    git('update-ref', `refs/remotes/origin/${branch}`, after)
    const event = join(root, 'push.json')
    writeFileSync(event, JSON.stringify({ before, after, ref: `refs/heads/${branch}`, repository: { full_name: 'slax-lab/slax-reader' } }))
    const env = { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: branch, GITHUB_REF: `refs/heads/${branch}`, GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'slax-lab/slax-reader', GITHUB_SHA: after }
    const directory = join(root, 'artifacts', branch)
    for (const command of ['prepare', 'smoke']) {
      const result = spawnSync(process.execPath, [script, command, directory], { cwd: root, env, encoding: 'utf8', timeout: 180000 })
      assert.equal(result.status, 0, result.stderr + result.stdout)
    }
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), manifest)
    const metadata = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'))
    assert.equal(metadata.version, branch === 'main' ? manifest.version : `${manifest.version}-${branch}`)
  }
})
