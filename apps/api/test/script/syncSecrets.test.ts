import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'smol-toml'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ROOT } from '../../script/root'
import { readSecretsFile, syncSecrets } from '../../script/deploy/sync-secrets'
import { workerNames, type ApiConfig } from '../../script/deploy/config'
import { RUNTIME_KEYS } from '../../script/deploy/runtimeKeys'
import type { CloudflareApi } from '../../script/deploy/topology'

const config = parse(fs.readFileSync(path.join(ROOT, 'deploy/cloudflare/api.toml.example'), 'utf8')) as ApiConfig
// The template publishes the plain variables (for example FRONT_END_URL) to every Worker through [vars].
const names = workerNames(config)
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

// Live state before the transition: the old Edge holds every key, Core and AI lack DEEPSEEK_API_KEY.
function account(scripts = [names.edge, names.core, names.ai]) {
  const held: Record<string, Set<string>> = {
    [names.edge]: new Set(Object.values(RUNTIME_KEYS).flat()),
    [names.core]: new Set(RUNTIME_KEYS.core.filter(key => key !== 'DEEPSEEK_API_KEY')),
    [names.ai]: new Set(RUNTIME_KEYS.ai.filter(key => key !== 'DEEPSEEK_API_KEY'))
  }
  const api: CloudflareApi = {
    async list<T>(pathname: string) {
      if (pathname === '/workers/scripts') return scripts.map(id => ({ id })) as T[]
      throw new Error(`unexpected list ${pathname}`)
    },
    async get<T>(pathname: string) {
      const script = decodeURIComponent(/^\/workers\/scripts\/([^/]+)\/settings$/.exec(pathname)![1])
      return { bindings: [...(held[script] ?? [])].map(name => ({ name, type: 'secret_text' })) } as T
    },
    async send() {
      throw new Error('secrets:sync must not change the account through the topology API')
    }
  }
  return { api, held }
}

describe('secrets:sync', () => {
  test('uploads only the missing keys each Worker reads, and never existing ones or values it was not asked for', async () => {
    const { api } = account()
    const upload = vi.fn(() => 0)
    const log = vi.fn()
    const values = { DEEPSEEK_API_KEY: 'deepseek-value', JWT_SECRET_TEXT: 'must-not-be-sent', UNRELATED: 'x' }
    expect(await syncSecrets({ api, config, values, dryRun: false, upload, log })).toBe(0)
    expect(upload.mock.calls).toEqual([
      ['core', { DEEPSEEK_API_KEY: 'deepseek-value' }],
      ['ai', { DEEPSEEK_API_KEY: 'deepseek-value' }]
    ])
    expect(log.mock.calls.flat().join('\n')).not.toContain('deepseek-value')
  })

  test('a dry run uploads nothing and lists key names only', async () => {
    const { api } = account()
    const upload = vi.fn(() => 0)
    const log = vi.fn()
    expect(await syncSecrets({ api, config, values: { DEEPSEEK_API_KEY: 'secret' }, dryRun: true, upload, log })).toBe(0)
    expect(upload).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(`would set on ${names.core}: DEEPSEEK_API_KEY`)
    expect(log.mock.calls.flat().join('\n')).not.toContain('secret\n')
  })

  test('a key absent from the file fails the run, and a Worker not deployed yet is skipped instead of created', async () => {
    const { api } = account([names.edge, names.core])
    const upload = vi.fn(() => 0)
    const log = vi.fn()
    expect(await syncSecrets({ api, config, values: {}, dryRun: false, upload, log })).toBe(1)
    expect(upload).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(`${names.core}: not in the secrets file: DEEPSEEK_API_KEY`)
    expect(log.mock.calls.flat().some(line => String(line).startsWith(`${names.ai}: not deployed yet`))).toBe(true)
  })

  test('nothing to do once every Worker holds its values', async () => {
    const { api, held } = account()
    held[names.core].add('DEEPSEEK_API_KEY')
    held[names.ai].add('DEEPSEEK_API_KEY')
    const upload = vi.fn(() => 0)
    const log = vi.fn()
    expect(await syncSecrets({ api, config, values: {}, dryRun: false, upload, log })).toBe(0)
    expect(upload).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Every Worker already holds the values its code reads.')
  })
})

describe('secrets file', () => {
  const write = (directory: string, name: string, text: string) => {
    const file = path.join(directory, name)
    fs.writeFileSync(file, text)
    return file
  }

  test('reads .env and JSON files outside the repository', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-'))
    directories.push(directory)
    expect(readSecretsFile(write(directory, 'prod.env', 'DEEPSEEK_API_KEY=abc\nMULTI="a\\nb"\n'), () => false)).toEqual({ DEEPSEEK_API_KEY: 'abc', MULTI: 'a\nb' })
    expect(readSecretsFile(write(directory, 'prod.json', '{"DEEPSEEK_API_KEY":"abc"}'), () => false)).toEqual({ DEEPSEEK_API_KEY: 'abc' })
    expect(() => readSecretsFile(write(directory, 'bad.json', '{"KEY":1}'), () => false)).toThrow('KEY must be a string')
  })

  test('refuses a file inside the repository unless git ignores it', () => {
    const inside = path.join(ROOT, 'apps/api/test/.tmp-secrets-check.env')
    expect(() => readSecretsFile(inside, () => false)).toThrow('inside the repository and not ignored by git')
    const ignored = path.join(ROOT, 'deploy/local/.tmp-secrets-check.env')
    fs.writeFileSync(ignored, 'A=b\n')
    try {
      expect(readSecretsFile(ignored, () => true)).toEqual({ A: 'b' })
    } finally {
      fs.rmSync(ignored, { force: true })
    }
  })
})
