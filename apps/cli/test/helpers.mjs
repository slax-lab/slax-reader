import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
export const apiKey = 'sr-synthetic-cli-test-key-not-real'
export const uid = 'fixture-bookmark-uuid'
export const item = { id: 42, bookmark_id: 42, bookmark_user_uuid: uid, title: 'Fixture article', alias_title: '', host_url: 'example.com', target_url: 'https://example.com/article', site_name: 'Example', status: 'success', created_at: '2026-01-01T00:00:00Z', tags: [{ name: 'test' }] }
export const bin = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const preload = fileURLToPath(new URL('preload.mjs', import.meta.url))

export function execute(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Timed out: ${program} ${args.join(' ')}\n${stderr}`)) }, 30000)
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }) })
    child.stdin.end(options.input || '')
  })
}

export async function fixture(t, executable = bin) {
  const home = await mkdtemp(join(tmpdir(), 'slax-cli-test-'))
  const requests = []
  const state = { code: 200, apiCode: 200, contentCode: 200, missingId: false, latest: version }
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const part of req) raw += part
    const url = new URL(req.url, 'http://localhost')
    const request = { path: url.pathname, query: Object.fromEntries(url.searchParams), method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : undefined }
    requests.push(request)
    res.statusCode = state.code
    if (url.pathname === '/v1/bookmark/content') {
      res.statusCode = state.contentCode
      res.end(state.contentCode === 200 ? (req.headers.accept === 'text/markdown' ? '# Fixture content' : 'Fixture content') : 'Content unavailable')
      return
    }
    let data = ''
    if (url.pathname === '/v1/user/me') data = { id: 1, email: 'fixture@example.test', username: 'fixture', avatar: '' }
    if (url.pathname === '/v1/bookmark/list') data = [item]
    if (url.pathname === '/v1/bookmark/metadata') data = { ...item, bookmark_id: state.missingId ? undefined : item.bookmark_id }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ code: state.apiCode, message: state.code < 400 ? 'OK' : 'Rejected by fixture', data }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const fakebin = join(home, 'bin')
  await mkdir(fakebin)
  const commandLog = join(home, 'commands.jsonl')
  for (const name of ['npm', 'npx', 'reader-cli']) {
    await writeFile(join(fakebin, name), `#!${process.execPath}\nimport fs from 'node:fs';fs.appendFileSync(process.env.CLI_COMMAND_LOG,JSON.stringify({name:${JSON.stringify(name)},args:process.argv.slice(2)})+'\\n');if(process.env.CLI_FAIL_COMMAND===${JSON.stringify(name)})process.exit(1);if(${JSON.stringify(name)}==='reader-cli')console.log(process.env.CLI_INSTALLED_VERSION);\n`, { mode: 0o755 })
  }
  const env = {
    PATH: `${fakebin}:${dirname(process.execPath)}:${process.env.PATH}`,
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
    APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'),
    TMPDIR: home, TEMP: home, TMP: home, NO_COLOR: '1', CI: '1',
    SLAX_NO_UPDATE_NOTIFIER: '1', SLAX_NO_SKILLS_NOTIFIER: '1',
    CLI_REGISTRY_VERSION: version, CLI_COMMAND_LOG: commandLog, CLI_INSTALLED_VERSION: version,
  }
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }) })
  const run = (args, extraEnv = {}, input) => execute(process.execPath, ['--import', preload, executable, ...args], { cwd: home, env: { ...env, ...extraEnv }, input })
  let configPath
  const login = async () => {
    const result = await run(['login', '--api-key', apiKey, '--api-base', base, '--json'])
    if (result.code !== 0) throw new Error(result.stderr + result.stdout)
    configPath = JSON.parse(result.stdout).data.configPath
    if (!configPath.startsWith(home)) throw new Error('Configuration escaped isolated home')
    return result
  }
  const writeState = async (name, content) => {
    if (!configPath) await login()
    await writeFile(join(dirname(configPath), name), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return { home, env, base, requests, state, run, login, writeState, commandLog, get configPath() { return configPath } }
}
