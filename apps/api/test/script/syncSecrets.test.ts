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
  })

  test('reads JSON backups: flat objects, name/value arrays, a byte order mark and scalar values', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-'))
    directories.push(directory)
    const read = (name: string, text: string) => readSecretsFile(write(directory, name, text), () => false)
    expect(read('bom.json', '\uFEFF{"A":"b"}')).toEqual({ A: 'b' })
    expect(read('scalars.json', '{"PORT":443,"ENABLED":true,"PEM":"-----BEGIN-----\\nabc"}')).toEqual({ PORT: '443', ENABLED: 'true', PEM: '-----BEGIN-----\nabc' })
    expect(read('pairs.json', '[{"name":"A","value":"1"},{"key":"B","value":"2"}]')).toEqual({ A: '1', B: '2' })
    expect(read('backup.txt', '  {"A":"b"}')).toEqual({ A: 'b' })
  })

  test('reads TOML backups of top-level keys, including multi-line strings', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-'))
    directories.push(directory)
    const text = "\uFEFF# old backup\nDEEPSEEK_API_KEY = \"abc\"\nPORT = 443\nPEM = '''\n-----BEGIN-----\nabc'''\n"
    expect(readSecretsFile(write(directory, 'old.toml', text), () => false)).toEqual({ DEEPSEEK_API_KEY: 'abc', PORT: '443', PEM: '-----BEGIN-----\nabc' })
  })

  test('TOML errors never echo a value', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-'))
    directories.push(directory)
    const failure = (name: string, text: string) => {
      try {
        readSecretsFile(write(directory, name, text), () => false)
      } catch (error) {
        return (error as Error).message
      }
      throw new Error('expected a failure')
    }
    const syntax = failure('syntax.toml', 'OPENAI_API_KEY = "sk-live-SECRET" x\n')
    expect(syntax).toBe('The secrets file is not valid TOML at line 1 column 35')
    const nested = failure('nested.toml', 'NOTE = "sk-live-SECRET"\n[vars]\nOPENAI_API_KEY = "sk-live-SECRET"\n')
    expect(nested).toBe('vars holds an object, not a string; expected top-level KEY = "value" lines. This file has: NOTE (string), vars (object)')
    for (const message of [syntax, nested]) expect(message).not.toContain('SECRET')
  })

  test('JSON errors never echo a value', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-'))
    directories.push(directory)
    const failure = (name: string, text: string) => {
      try {
        readSecretsFile(write(directory, name, text), () => false)
      } catch (error) {
        return (error as Error).message
      }
      throw new Error('expected a failure')
    }
    const syntax = failure('syntax.json', '{"OPENAI_API_KEY":"sk-live-SECRET" "B":"c"}')
    expect(syntax).toMatch(/^The secrets file is not valid JSON at position \d+/)
    const nested = failure('nested.json', '{"prod":{"OPENAI_API_KEY":"sk-live-SECRET"},"note":"sk-live-SECRET"}')
    expect(nested).toBe('prod holds an object, not a string; expected {"KEY": "value"} or [{"name": "KEY", "value": "value"}]. This file has: prod (object), note (string)')
    expect(failure('null.json', '{"A":null}')).toContain('A holds a null')
    expect(failure('scalar.json', '"sk-live-SECRET"')).toContain('holds a string;')
    expect(failure('entry.json', '[{"name":"A"}, "sk-live-SECRET"]')).toBe('Entry 0 of the secrets file needs a "name" (or "key") and a "value"')
    expect(failure('loose.json', '["sk-live-SECRET"]')).toBe('Entry 0 of the secrets file needs a "name" (or "key") and a "value"')
    for (const message of [syntax, nested]) expect(message).not.toContain('SECRET')
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
