import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { type ApiConfig, type McpPhase, parseArgs, readConfig, workerNames, type Target } from './config'
import { loadApiEnv } from '../env'
import { RUNTIME_KEYS } from './runtimeKeys'

// Read-only view of the Cloudflare account state that decides which Worker owns each job surface.
export interface TopologyState {
  scripts: string[]
  workflows: { name: string; script_name: string; class_name: string }[]
  queues: { queue_id: string; queue_name: string; consumers: { script?: string; service?: string; type?: string; consumer_id?: string }[] }[]
  schedules: Record<string, string[]>
  // Scripts that still own a namespace of the removed MCP server's class.
  mcp: string[]
}

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

const queueNames = (config: ApiConfig) => ((config.queues as { consumers?: { queue?: unknown }[] } | undefined)?.consumers ?? []).map(consumer => String(consumer.queue))
const workflowNames = (config: ApiConfig) => ((config.workflows as { name?: unknown }[] | undefined) ?? []).map(workflow => String(workflow.name))

export async function readState(api: CloudflareApi, config: ApiConfig): Promise<TopologyState> {
  const names = workerNames(config)
  const scripts = (await api.list<{ id: string }>('/workers/scripts')).map(script => script.id)
  const wanted = new Set(workflowNames(config))
  const workflows = (await api.list<TopologyState['workflows'][number]>('/workflows')).filter(workflow => wanted.has(workflow.name))
  const queuesWanted = new Set(queueNames(config))
  const queues = (await api.list<TopologyState['queues'][number]>('/queues')).filter(queue => queuesWanted.has(queue.queue_name))
  const schedules: Record<string, string[]> = {}
  for (const script of [names.core, names.edge].filter(name => scripts.includes(name))) {
    const result = await api.get<{ schedules?: { cron: string }[] }>(`/workers/scripts/${encodeURIComponent(script)}/schedules`)
    schedules[script] = (result.schedules ?? []).map(schedule => schedule.cron)
  }
  const owners = new Set([names.core, names.edge])
  const mcp = (await api.list<{ class: string; script: string }>('/workers/durable_objects/namespaces'))
    .filter(namespace => namespace.class === 'SlaxMcpServer' && owners.has(namespace.script))
    .map(namespace => namespace.script)
  return { scripts, workflows, queues, schedules, mcp }
}

const consumerScript = (consumer: TopologyState['queues'][number]['consumers'][number]) => consumer.script ?? consumer.service

// Problems that keep an installation from the five-Worker topology; empty means the transition is complete.
export function topologyProblems(state: TopologyState, config: ApiConfig): string[] {
  const names = workerNames(config)
  const problems: string[] = []
  for (const target of ['objects', 'ai', 'core'] as const) if (!state.scripts.includes(names[target])) problems.push(`Worker ${names[target]} (${target}) is not deployed`)
  for (const name of workflowNames(config)) {
    const workflow = state.workflows.find(item => item.name === name)
    if (workflow && workflow.script_name !== names.core) problems.push(`Workflow ${name} belongs to ${workflow.script_name}, not ${names.core}`)
  }
  for (const name of queueNames(config)) {
    const queue = state.queues.find(item => item.queue_name === name)
    // A queue missing from the account has no consumer to split between Edge and Core; Core's deploy fails
    // on its consumer binding until the queue is created (`pnpm api -- resources --apply`).
    if (!queue) continue
    const owners = queue.consumers.filter(consumer => consumer.type !== 'http_pull').map(consumerScript)
    if (owners.length !== 1 || owners[0] !== names.core) problems.push(`Queue ${name} is consumed by ${owners.join(', ') || 'nothing'}, not only ${names.core}`)
  }
  if (state.schedules[names.edge]?.length) problems.push(`Edge ${names.edge} still has cron schedules ${state.schedules[names.edge].join(', ')}`)
  // The ownership move is complete only once Core runs every configured schedule.
  const crons = ((config.triggers as { crons?: unknown[] } | undefined)?.crons ?? []).map(String)
  const coreCrons = new Set(state.schedules[names.core] ?? [])
  const missingCrons = crons.filter(cron => !coreCrons.has(cron))
  if (state.scripts.includes(names.core) && missingCrons.length) problems.push(`Core ${names.core} lacks cron schedules ${missingCrons.join(', ')}`)
  for (const script of state.mcp) problems.push(`MCP namespace SlaxMcpServer still exists on ${script}`)
  return problems
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

const describeMissing = (missing: Record<string, string[]>) =>
  Object.entries(missing)
    .map(([script, keys]) => `- ${script}: ${keys.join(', ')}`)
    .join('\n')

export const TRANSITION_HINT = 'Run `pnpm api -- topology:transition --step <1..4>` for this installation first (docs/api/CLOUDFLARE-DEPLOY-EN.md, "Five-Worker transition").'

export async function requireTopology(api: CloudflareApi, config: ApiConfig): Promise<void> {
  const problems = topologyProblems(await readState(api, config), config)
  if (problems.length) throw new Error(`This installation has not completed the five-Worker transition:\n- ${problems.join('\n- ')}\n${TRANSITION_HINT}`)
  const missing = await missingRuntimeValues(api, config, ['edge', 'core', 'ai', 'objects'])
  if (Object.keys(missing).length)
    throw new Error(
      `These Workers lack values their code reads. Run \`pnpm api -- secrets:sync --from <file with the values>\` (or add them to [vars] of the selected configuration), then release again:\n${describeMissing(missing)}`
    )
}

export type Deploy = (targets: Target[], mcp: McpPhase) => Promise<number>

export interface TransitionOptions {
  step: 1 | 2 | 3 | 4
  dryRun: boolean
  api: CloudflareApi
  config: ApiConfig
  deploy: Deploy
  log?: (line: string) => void
}

// Each step checks the state it starts from, is safe to repeat, and prints every change it makes.
export async function transition({ step, dryRun, api, config, deploy, log = console.log }: TransitionOptions): Promise<number> {
  const names = workerNames(config)
  const before = await readState(api, config)
  const act = async (description: string, action: () => Promise<unknown>) => {
    log(`${dryRun ? 'would' : 'will'} ${description}`)
    if (!dryRun) await action()
  }
  const publish = async (targets: Target[], mcp: McpPhase = 'keep-mcp') => {
    let status = 0
    const note = mcp === 'retire-mcp' ? ' and delete its SlaxMcpServer namespace' : ''
    await act(`deploy ${targets.map(target => names[target]).join(', ')}${note}`, async () => {
      status = await deploy(targets, mcp)
    })
    return status
  }
  // Steps 1 to 3 change only ownership and keep every namespace, so each can be rolled back.
  const pendingOwnership = (state: TopologyState) => topologyProblems(state, config).filter(problem => !problem.startsWith('Edge ') && !problem.startsWith('MCP '))
  // Every Worker that newly runs moved code must already hold the values that code reads.
  const requireValues = async (targets: readonly (keyof typeof RUNTIME_KEYS)[]) => {
    const missing = await missingRuntimeValues(api, config, targets)
    if (!Object.keys(missing).length) return
    const message = `These Workers lack values their code reads. Run \`pnpm api -- secrets:sync --from <file with the values>\` (or add them to [vars] of the selected configuration), then rerun this step:\n${describeMissing(missing)}`
    if (dryRun) log(`would stop: ${message}`)
    else throw new Error(message)
  }
  if (step === 1) {
    await requireValues(['objects'])
    return publish(['browser', 'objects'])
  }
  if (step === 2) {
    if (!before.scripts.includes(names.objects)) throw new Error(`Step 2 requires ${names.objects}; run step 1 first`)
    await requireValues(['ai', 'core'])
    // Core goes before AI: AI binds the Workflows by script_name, and only the new Core exports their classes (the
    // old Core does not; the old Edge does). The old AI needs nothing the new Core drops, since its AiEntry methods
    // are unchanged.
    for (const queue of before.queues)
      for (const consumer of queue.consumers)
        if (consumerScript(consumer) === names.edge && consumer.consumer_id)
          await act(`remove Edge consumer of ${queue.queue_name}`, () => api.send('DELETE', `/queues/${queue.queue_id}/consumers/${consumer.consumer_id}`))
    if (before.schedules[names.edge]?.length)
      await act(`clear Edge cron schedules ${before.schedules[names.edge].join(', ')}`, () =>
        api.send('PUT', `/workers/scripts/${encodeURIComponent(names.edge)}/schedules`, [] satisfies { cron: string }[])
      )
    const published = await publish(['core'])
    if (published) return published
    const ai = await publish(['ai'])
    if (ai || dryRun) return ai
    const counts = (state: TopologyState) => Object.fromEntries(state.workflows.map(workflow => [workflow.name, workflow.script_name]))
    const after = await readState(api, config)
    log(`workflows before ${JSON.stringify(counts(before))}, after ${JSON.stringify(counts(after))}`)
    const left = pendingOwnership(after)
    if (left.length) throw new Error(`Core did not take ownership:\n- ${left.join('\n- ')}`)
    return 0
  }
  if (step === 3) {
    const pending = pendingOwnership(before)
    if (pending.length) throw new Error(`Step 3 requires step 2:\n- ${pending.join('\n- ')}`)
    await requireValues(['edge'])
    const status = await publish(['edge'])
    log(`Repoint the newsletter Email Routing rule from ${names.edge} to ${names.core} in the Cloudflare dashboard, check the slim Edge, then run step 4.`)
    return status
  }
  // Step 4 is the only irreversible step: it deletes the MCP server's stored sessions.
  const problems = topologyProblems(before, config).filter(problem => !problem.startsWith('MCP '))
  if (problems.length) {
    log(`Transition incomplete; finish steps 1 to 3 first:\n- ${problems.join('\n- ')}`)
    return 1
  }
  if (before.mcp.length) {
    // Edge first: Core's namespace can be deleted only once no Worker binds to it, and the slim Edge binds none.
    for (const target of ['edge', 'core'] as const) {
      if (!before.mcp.includes(names[target])) continue
      const status = await publish([target], 'retire-mcp')
      if (status) return status
    }
    if (dryRun) return 0
    const left = (await readState(api, config)).mcp
    if (left.length) throw new Error(`SlaxMcpServer namespaces remain on ${left.join(', ')}`)
  }
  log('Five-Worker topology verified: Objects, AI and Core deployed; Workflows and queue consumers owned by Core; Edge has no schedules; no MCP namespace remains.')
  return 0
}

// CI passes CLOUDFLARE_API_TOKEN; an operator shell falls back to the token of `wrangler login`.
export function accountApi(config: ApiConfig, token = process.env.CLOUDFLARE_API_TOKEN): CloudflareApi {
  const accountId = String(config.account_id || process.env.CLOUDFLARE_ACCOUNT_ID || '')
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error('Set account_id in the selected configuration or CLOUDFLARE_ACCOUNT_ID to check the Worker topology')
  if (!token) {
    token = execFileSync('wrangler', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')
      .pop()
  }
  if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN or run `wrangler login` to check the Worker topology')
  return cloudflareApi(accountId, token)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const index = args.indexOf('--step')
  const step = Number(index >= 0 ? args[index + 1] : NaN)
  const rest = index >= 0 ? [...args.slice(0, index), ...args.slice(index + 2)] : args
  ;(async () => {
    if (![1, 2, 3, 4].includes(step)) throw new Error('Usage: pnpm api -- topology:transition --step <1|2|3|4> [--dry-run] [--config <path>] [--env <name>]')
    const options = parseArgs(rest, ['--dry-run'])
    if (options.target) throw new Error('topology:transition selects its own Workers per step')
    loadApiEnv()
    const config = readConfig(options.config, options.environment)
    const { deploy } = await import('./deploy')
    const passthrough = [...(options.config ? ['--config', options.config] : []), ...(options.environment ? ['--env', options.environment] : [])]
    return transition({
      step: step as 1 | 2 | 3 | 4,
      dryRun: options.flags.has('--dry-run'),
      api: accountApi(config),
      config,
      deploy: async (targets, mcp) => {
        for (const target of targets) {
          const status = await deploy([target, ...passthrough], { mcp })
          if (status) return status
        }
        return 0
      }
    })
  })()
    .then(code => {
      process.exitCode = code
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
