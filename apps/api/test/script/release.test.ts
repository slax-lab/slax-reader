import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'smol-toml'
import { describe, expect, test, vi } from 'vitest'
import { ROOT } from '../../script/root'
import { cloudflareApi, readReleaseState, requireValues, type CloudflareApi } from '../../script/deploy/topology'
import { releaseOrder } from '../../script/deploy/deploy'
import { workerNames, type ApiConfig } from '../../script/deploy/config'
import { RUNTIME_KEYS } from '../../script/deploy/runtimeKeys'

const config = parse(fs.readFileSync(path.join(ROOT, 'deploy/cloudflare/api.toml.example'), 'utf8')) as ApiConfig
const names = workerNames(config)

// An account that answers the reads a release makes. Every Worker holds what its code reads unless a test removes it.
function account(options: { scripts?: string[]; mcp?: string[]; coreTag?: string } = {}) {
  const scripts = options.scripts ?? [names.browser, names.objects, names.vector, names.core, names.ai, names.edge]
  const secrets: Record<string, Set<string>> = Object.fromEntries(
    (['edge', 'core', 'ai', 'objects', 'vector'] as const).map(target => [names[target], new Set(RUNTIME_KEYS[target])])
  )
  const calls: string[] = []
  const api: CloudflareApi = {
    async list<T>(pathname: string) {
      calls.push(`GET ${pathname}`)
      if (pathname === '/workers/scripts') return scripts.map(id => ({ id })) as T[]
      if (pathname === '/workers/durable_objects/namespaces')
        return [...(options.mcp ?? []).map(script => ({ class: 'SlaxMcpServer', script })), { class: 'SlaxMcpServer', script: 'another-app' }] as T[]
      throw new Error(`unexpected list ${pathname}`)
    },
    async get<T>(pathname: string) {
      calls.push(`GET ${pathname}`)
      const settings = /^\/workers\/scripts\/([^/]+)\/settings$/.exec(pathname)
      if (settings) return { bindings: [...(secrets[decodeURIComponent(settings[1])] ?? [])].map(name => ({ name, type: 'secret_text' })) } as T
      if (pathname === `/workers/services/${names.core}`) return { default_environment: { script: { migration_tag: options.coreTag } } } as T
      throw new Error(`unexpected ${pathname}`)
    },
    async send<T>(method: string, pathname: string): Promise<T> {
      throw new Error(`a release check must not write: ${method} ${pathname}`)
    }
  }
  return { api, secrets, calls }
}

describe('the only release precondition is that every Worker holds the values its code reads', () => {
  test('a secret held only by another Worker stops the release, naming Worker and key but never the value', async () => {
    const { api, secrets } = account()
    await expect(requireValues(api, config)).resolves.toBeUndefined()
    secrets[names.core].delete('DEEPSEEK_API_KEY')
    secrets[names.ai].delete('DEEPSEEK_API_KEY')
    secrets[names.edge].add('DEEPSEEK_API_KEY')
    await expect(requireValues(api, config)).rejects.toThrow(`- ${names.core}: DEEPSEEK_API_KEY\n- ${names.ai}: DEEPSEEK_API_KEY`)
    await expect(requireValues(api, config)).rejects.toThrow('secrets:sync')
  })

  test('a value published through [vars] satisfies the check, and a new Worker needs keys other Workers hold', async () => {
    // The template publishes FRONT_END_URL through [vars], so Objects lacking it as a secret is fine.
    const { api, secrets } = account()
    secrets[names.objects] = new Set()
    await expect(requireValues(api, config)).resolves.toBeUndefined()
    const withoutVars = structuredClone(config)
    delete (withoutVars.vars as Record<string, unknown>).FRONT_END_URL
    await expect(requireValues(api, withoutVars)).rejects.toThrow(`${names.objects}: FRONT_END_URL`)
    // A Worker not deployed yet is checked too: it cannot hold secrets before it exists, so its first release
    // needs the value in [vars], which the template provides.
    const undeployed = account({ scripts: [names.browser, names.vector, names.core, names.ai, names.edge] })
    await expect(requireValues(undeployed.api, config)).resolves.toBeUndefined()
    await expect(requireValues(undeployed.api, withoutVars)).rejects.toThrow(`${names.objects}: FRONT_END_URL`)
  })

  test('the Vector Worker needs the encoder key and the edge shared secret that Core and AI hold', async () => {
    const { api, secrets } = account()
    expect(RUNTIME_KEYS.vector).toEqual(['EDGE_SHARED_SECRET', 'JINA_API_KEY'])
    secrets[names.vector] = new Set()
    await expect(requireValues(api, config)).rejects.toThrow(`- ${names.vector}: EDGE_SHARED_SECRET, JINA_API_KEY`)
  })

  test('a key no Worker holds is an unconfigured optional feature and does not block', async () => {
    const { api, secrets } = account()
    for (const keys of Object.values(secrets)) keys.delete('TELEGRAM_WEBHOOK_SECRET')
    expect(RUNTIME_KEYS.core).toContain('TELEGRAM_WEBHOOK_SECRET')
    await expect(requireValues(api, config)).resolves.toBeUndefined()
  })
})

describe('the account decides the publication order', () => {
  const order = (steps: ReturnType<typeof releaseOrder>) => steps.map(step => `${step.target}${step.mcp === 'retired' ? '' : `:${step.mcp}`}`)

  test('the first release after the split deletes the MCP namespaces in one run, Edge before Core', async () => {
    const { api, calls } = account({ scripts: [names.browser, names.core, names.ai, names.edge], mcp: [names.edge, names.core], coreTag: 'vector-preference-v1' })
    const state = await readReleaseState(api, config)
    expect(state).toEqual({ mcp: [names.edge, names.core], edge: names.edge, coreMigrationTag: 'vector-preference-v1' })
    // Core first keeps the stub while the old Edge binds its namespace, then Edge stops binding it and deletes its
    // own, and the second Core publication deletes Core's.
    expect(order(releaseOrder(state))).toEqual(['browser', 'objects', 'vector', 'core:keep-mcp', 'ai', 'edge:retire-mcp', 'core:retire-mcp'])
    expect(calls.every(call => call.startsWith('GET '))).toBe(true)
  })

  test('later releases publish each Worker once, keeping the deletion tag Core already carries', async () => {
    const { api } = account({ coreTag: 'retire-mcp-v1' })
    expect(order(releaseOrder(await readReleaseState(api, config)))).toEqual(['browser', 'objects', 'vector', 'core:retire-mcp', 'ai', 'edge'])
    const fresh = account({ coreTag: 'vector-preference-v1' })
    expect(order(releaseOrder(await readReleaseState(fresh.api, config)))).toEqual(['browser', 'objects', 'vector', 'core', 'ai', 'edge'])
  })

  test('a single-Worker release of Core keeps the stub while Edge still binds the namespace', async () => {
    const pending = await readReleaseState(account({ mcp: [names.edge, names.core] }).api, config)
    expect(order(releaseOrder(pending, 'core'))).toEqual(['core:keep-mcp'])
    expect(order(releaseOrder(pending, 'edge'))).toEqual(['edge:retire-mcp'])
    const onlyCore = await readReleaseState(account({ mcp: [names.core] }).api, config)
    expect(order(releaseOrder(onlyCore, 'core'))).toEqual(['core:retire-mcp'])
  })

  test('another application owning the same class name is ignored', async () => {
    const state = await readReleaseState(account({ mcp: [] }).api, config)
    expect(state.mcp).toEqual([])
  })
})

describe('Cloudflare API client', () => {
  test('lists read every page so a later page cannot hide a namespace', async () => {
    const pages = [[{ queue_name: 'a' }], [{ queue_name: 'b' }]]
    const fetcher = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'))
      return Response.json({ success: true, result: pages[page - 1], result_info: { page, total_pages: 2 } })
    })
    const api = cloudflareApi('a'.repeat(32), 'token-value', fetcher as unknown as typeof fetch)
    expect(await api.list('/queues')).toEqual([{ queue_name: 'a' }, { queue_name: 'b' }])
    expect(fetcher.mock.calls.map(([url]) => new URL(url).search)).toEqual(['?per_page=100&page=1', '?per_page=100&page=2'])
  })

  test('sends the bearer token, scopes calls to the account and reports error codes without response bodies', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: false, errors: [{ code: 10007, message: 'secret detail' }] }, { status: 403 }))
    const api = cloudflareApi('a'.repeat(32), 'token-value', fetcher as unknown as typeof fetch)
    await expect(api.get('/workers/scripts')).rejects.toThrow('Cloudflare API GET /workers/scripts failed (HTTP 403, codes 10007)')
    await expect(api.get('/workers/scripts')).rejects.not.toThrow('secret detail')
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/workers/scripts`)
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer token-value')
  })
})
