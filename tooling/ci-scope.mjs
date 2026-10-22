import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const scopeNames = ['web', 'extension', 'api', 'mobile', 'cli', 'tooling', 'cliTooling', 'extensionTooling', 'design', 'icons', 'rulesync', 'openspec', 'ghAw']
const apps = ['web', 'extension', 'api', 'mobile', 'cli']
const frontend = ['web', 'extension']
const guards = ['rulesync', 'openspec', 'ghAw']
const readmeName = /^README(?:[_-][A-Za-z0-9-]+)?(?:\.(?:md|rst|txt))?$/

export function selectScopes(paths) {
  if (!Array.isArray(paths)) throw new Error('Expected a complete changed-path array')
  const reasons = Object.fromEntries(scopeNames.map(name => [name, []]))
  const add = (names, path) => { for (const name of names) if (!reasons[name].includes(path)) reasons[name].push(path) }
  for (const path of paths) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..') || path.includes('\0')) throw new Error('Invalid repository-relative changed path')
    if (['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc'].includes(path)) add(scopeNames, path)
    if (path.startsWith('packages/contracts/')) add(apps, path)
    if (/^packages\/(frontend-types|frontend-utils|selection)\//.test(path)) add(frontend, path)
    if (path.startsWith('packages/') && !/^packages\/(contracts|frontend-types|frontend-utils|selection)\//.test(path)) add(apps, path)
    if (/^apps\/(web|extension|api|mobile|cli)\//.test(path)) {
      const app = path.split('/')[1]
      const parts = path.split('/')
      const agentDocument = parts.length === 3 && /^(AGENTS|CLAUDE)\.md$/.test(parts[2])
      const readme = parts.length === 3 && readmeName.test(parts[2])
      if (!agentDocument && (!readme || app === 'cli')) add([app], path)
      if (app === 'cli' && !agentDocument) add(['cliTooling'], path)
      if (app === 'extension' && !agentDocument) add(['extensionTooling'], path)
      if (/\/package\.json$|^apps\/(web|extension)\/(config\/|env\.schema|nuxt\.config|wxt\.config)/.test(path)) add(['tooling'], path)
    }
    if (path === 'tooling/pnpm-command.mjs') add([...apps, 'tooling', 'cliTooling', 'extensionTooling'], path)
    if (/^tooling\/(run-app|env-files)(\.|$)/.test(path)) add([...frontend, 'tooling', 'extensionTooling'], path)
    if (/^tooling\/(web|extension|api|mobile|cli)\.mjs$/.test(path)) add([path.split('/')[1].split('.')[0], 'tooling'], path)
    if (/^tooling\/cli.*\.mjs$/.test(path) || /^\.github\/workflows\/cli-.*\.yml$/.test(path)) add(['cliTooling'], path)
    if (/^tooling\/extension-release.*\.(mjs|py)$/.test(path) || path === '.github/workflows/extension-release.yml' || path === 'tooling/cli-release.mjs' || path === 'tooling/extension.mjs') add(['extensionTooling'], path)
    if (path === 'apps/web/env.schema.ts') add(['extensionTooling'], path)
    if (path === '.github/workflows/cli-ci.yml') add(['cli'], path)
    if (/^tooling\//.test(path) && !/^tooling\/cli/.test(path)) add(['tooling'], path)
    if (path.startsWith('deploy/mobile/') && !(path.split('/').length === 3 && readmeName.test(path.split('/')[2]))) add(['mobile'], path)
    if (path.startsWith('deploy/cloudflare/') || (path.startsWith('deploy/local/') && !/^deploy\/local\/\.env\.(web|extension)/.test(path))) add(['api', 'tooling'], path)
    if (/^deploy\/local\/\.env\.(web|extension)/.test(path)) add([path.split('/')[2].split('.')[2], 'tooling'], path)
    if (path === 'deploy/cloudflare/api.toml.example') add(['tooling'], path)
    if (path === 'docs/mobile/source-manifest.json') add(['mobile'], path)
    if (path.startsWith('docs/design/')) add(['design'], path)
    if (path === 'DESIGN.md' || /^\.rulesync\/rules\/(design-system|web-design|extension-design)\.md$/.test(path)) add(['design'], path)
    if (/^tooling\/design-reference/.test(path)) add(['design'], path)
    if (/^tooling\/icon-registry/.test(path) || path.startsWith('apps/web/app/assets/icons/') || path.startsWith('apps/web/app/icons/')) add(['icons'], path)
    if (path.startsWith('docs/design/reference/')) add(['icons'], path)
    if (path.startsWith('.rulesync/') || /^rulesync\./.test(path) || /(^|\/)(AGENTS|CLAUDE)\.md$/.test(path) || /^\.(agents|claude|codex)\//.test(path)) add(['rulesync'], path)
    if (path.startsWith('openspec/')) add(['openspec'], path)
    if (/^\.agents\/skills\/|^\.claude\/skills\/|^\.claude\/commands\/opsx\//.test(path)) add(['openspec'], path)
    if (/^\.github\/workflows\/(.*\.md|.*\.lock\.yml|aw\.json|shared\/)/.test(path) || path.startsWith('.github/aw/') || path === 'tooling/check-gh-aw-drift.sh') add(['ghAw'], path)
    if (path === '.github/workflows/agent-config.yml') add(guards, path)
    if (path === '.github/workflows/frontend-ci.yml') add([...frontend, 'design', 'icons', 'tooling'], path)
    if (/^\.github\/workflows\/api-(ci|deploy)\.yml$/.test(path)) add(['api'], path)
    if (path === '.github/workflows/mobile-ci.yml') add(['mobile'], path)
    if (path === '.github/workflows/web-deploy.yml') add(['tooling'], path)
    if (path === '.github/workflows/tooling-ci.yml') add(['tooling', 'cliTooling', 'extensionTooling'], path)
    if (path.startsWith('.github/workflows/')) add(['tooling'], path)
    if (/^tooling\/ci-/.test(path) || path.startsWith('.github/actions/ci-scope/')) add(scopeNames, path)
  }
  return { scopes: Object.fromEntries(scopeNames.map(name => [name, reasons[name].length > 0])), reasons }
}

export function changedPaths({ base, head, cwd = process.cwd() }) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const sha of [base, head]) {
    if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha) || /^0+$/.test(sha)) throw new Error('Expected immutable base and head commit SHAs')
    git(['cat-file', '-e', `${sha}^{commit}`])
  }
  if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') throw new Error('CI selection requires complete Git history')
  const ancestor = git(['merge-base', base, head]).trim()
  if (!/^[a-f0-9]{40}$/.test(ancestor)) throw new Error('Could not establish the PR merge base')
  const output = git(['diff', '--no-renames', '--name-only', '-z', ancestor, head, '--'])
  if (output && !output.endsWith('\0')) throw new Error('Incomplete Git changed-path listing')
  return output ? output.split('\0').slice(0, -1) : []
}

export function selectPullRequest(env = process.env, cwd = process.cwd()) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request') throw new Error('CI selection requires a pull_request event')
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  if (!event.pull_request?.base?.sha || !event.pull_request?.head?.sha) throw new Error('Pull request revisions are missing')
  return selectScopes(changedPaths({ base: event.pull_request.base.sha, head: event.pull_request.head.sha, cwd }))
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    const result = selectPullRequest()
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, scopeNames.map(name => `${name}=${result.scopes[name]}\n`).join(''))
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### CI selection\n\n' + scopeNames.map(name => `- ${name}: ${result.scopes[name] ? `selected (${result.reasons[name].length} input paths)` : 'skipped'}`).join('\n') + '\n')
    console.log(JSON.stringify(result))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
