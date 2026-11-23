import { execFileSync } from 'node:child_process'
import { type ApiConfig, workerNames } from './config'
import { RUNTIME_KEYS } from './runtimeKeys'

export interface CloudflareApi {
  get<T>(pathname: string): Promise<T>
  // Reads every page of a paginated list, so a check never passes on a partial result.
  list<T>(pathname: string): Promise<T[]>
  send<T>(method: 'PUT' | 'DELETE', pathname: string, body?: unknown): Promise<T>
}

export function cloudflareApi(accountId: string, token: string, fetcher: typeof fetch = fetch): CloudflareApi {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`
  const call = async <T>(method: string, pathname: string, body?: unknown): Promise<{ result: T; pages: number }> => {
    const response = await fetcher(`${base}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const data = (await response.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { code?: number }[]; result_info?: { page?: number; total_pages?: number } }
    if (!response.ok || data.success === false) {
      const codes = (data.errors ?? []).map(error => error.code).filter(Boolean)
      throw new Error(`Cloudflare API ${method} ${pathname.split('?')[0]} failed (HTTP ${response.status}${codes.length ? `, codes ${codes.join(',')}` : ''})`)
    }
    return { result: data.result as T, pages: data.result_info?.total_pages ?? 1 }
  }
  return {
    get: async pathname => (await call<never>('GET', pathname)).result,
    list: async <T>(pathname: string) => {
      const items: T[] = []
      for (let page = 1, pages = 1; page <= pages && page <= 100; page++) {
        const { result, pages: total } = await call<T[]>('GET', `${pathname}${pathname.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
        items.push(...(result ?? []))
        pages = total
      }
      return items
    },
    send: async (method, pathname, body) => (await call<never>(method, pathname, body)).result
  }
}

// Account facts that decide how a release publishes. A release reads them once, before its first publication.
export interface ReleaseState {
  // Scripts that still own a namespace of the removed MCP server's class.
  mcp: string[]
  // Edge's script name, so a release can tell whether Edge still binds Core's namespace.
  edge: string
  // Core's live Durable Object migration tag: once it is the MCP deletion tag, every later Core configuration must
  // keep that tag, or Wrangler would replay the whole history.
  coreMigrationTag?: string
}

export async function readReleaseState(api: CloudflareApi, config: ApiConfig): Promise<ReleaseState> {
  const names = workerNames(config)
  const owners = new Set([names.core, names.edge])
  const mcp = (await api.list<{ class: string; script: string }>('/workers/durable_objects/namespaces'))
    .filter(namespace => namespace.class === 'SlaxMcpServer' && owners.has(namespace.script))
    .map(namespace => namespace.script)
  const scripts = new Set((await api.list<{ id: string }>('/workers/scripts')).map(script => script.id))
  const service = scripts.has(names.core)
    ? await api.get<{ default_environment?: { script?: { migration_tag?: string } } }>(`/workers/services/${encodeURIComponent(names.core)}`)
    : undefined
  return { mcp: [...new Set(mcp)], edge: names.edge, coreMigrationTag: service?.default_environment?.script?.migration_tag }
}

const describeMissing = (missing: Record<string, string[]>) =>
  Object.entries(missing)
    .map(([script, keys]) => `- ${script}: ${keys.join(', ')}`)
    .join('\n')

// The only release precondition: every Worker already holds the secrets and strings its code reads.
export async function requireValues(api: CloudflareApi, config: ApiConfig): Promise<void> {
  const missing = await missingRuntimeValues(api, config, ['edge', 'core', 'ai', 'objects'])
  if (Object.keys(missing).length)
    throw new Error(
      `These Workers lack values their code reads. Run \`pnpm api -- secrets:sync --from <file with the values>\` (or add them to [vars] of the selected configuration), then release again:\n${describeMissing(missing)}`
    )
}

// Values that would be lost when code moves to another Worker, by name only. Deploys use --keep-vars, so a
// secret set by `wrangler secret put` stays only on the script that had it. A key the new owner's code reads that
// another API Worker of this installation holds, but neither the new owner nor the published [vars] provides, is
// such a loss. Keys no API Worker holds are optional features that are unconfigured today and are not reported.
export async function missingRuntimeValues(api: CloudflareApi, config: ApiConfig, targets: readonly (keyof typeof RUNTIME_KEYS)[]): Promise<Record<string, string[]>> {
  const names = workerNames(config)
  const scripts = new Set((await api.list<{ id: string }>('/workers/scripts')).map(script => script.id))
  const published = new Set(Object.keys((config.vars as Record<string, unknown> | undefined) ?? {}))
  const held: Record<string, Set<string>> = {}
  for (const target of ['edge', 'core', 'ai', 'objects'] as const) {
    held[target] = new Set()
    if (!scripts.has(names[target])) continue
    const settings = await api.get<{ bindings?: { name: string; type: string }[] }>(`/workers/scripts/${encodeURIComponent(names[target])}/settings`)
    for (const binding of settings.bindings ?? []) if (binding.type === 'secret_text' || binding.type === 'plain_text') held[target].add(binding.name)
  }
  const anywhere = new Set(Object.values(held).flatMap(keys => [...keys]))
  const missing: Record<string, string[]> = {}
  for (const target of targets) {
    const lacking = RUNTIME_KEYS[target].filter(key => anywhere.has(key) && !published.has(key) && !held[target].has(key))
    if (lacking.length) missing[names[target]] = lacking
  }
  return missing
}

// CI passes CLOUDFLARE_API_TOKEN; an operator shell falls back to the token of `wrangler login`.
export function accountApi(config: ApiConfig, token = process.env.CLOUDFLARE_API_TOKEN): CloudflareApi {
  const accountId = String(config.account_id || process.env.CLOUDFLARE_ACCOUNT_ID || '')
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error('Set account_id in the selected configuration or CLOUDFLARE_ACCOUNT_ID to read the Cloudflare account')
  if (!token) {
    token = execFileSync('wrangler', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')
      .pop()
  }
  if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN or run `wrangler login` to read the Cloudflare account')
  return cloudflareApi(accountId, token)
}
