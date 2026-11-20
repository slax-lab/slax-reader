import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'smol-toml'
import { describe, expect, test, vi } from 'vitest'
import { ROOT } from '../../script/root'
import { cloudflareApi, requireTopology, topologyProblems, transition, type CloudflareApi, type TopologyState } from '../../script/deploy/topology'
import { workerNames, type ApiConfig, type McpPhase, type Target } from '../../script/deploy/config'

const config = parse(fs.readFileSync(path.join(ROOT, 'deploy/cloudflare/api.toml.example'), 'utf8')) as ApiConfig
const workflows = (config.workflows as { name: string; class_name: string }[]).map(workflow => workflow.name)
const queues = ((config.queues as { consumers: { queue: string }[] }).consumers ?? []).map(consumer => consumer.queue)
const names = workerNames(config)
const EDGE = names.edge

// An in-memory account that applies the same changes the Cloudflare API would.
function account(owner: 'edge' | 'core', extra: Partial<TopologyState> = {}) {
  const script = owner === 'edge' ? EDGE : 'reader-core'
  const state: TopologyState = {
    scripts: ['reader-browser', 'reader-core', 'reader-ai', EDGE],
    workflows: (config.workflows as { name: string; class_name: string }[]).map(workflow => ({ ...workflow, script_name: script })),
    queues: queues.map((queue, index) => ({ queue_id: `q${index}`, queue_name: queue, consumers: [{ script, consumer_id: `c${index}`, type: 'worker' }] })),
    schedules: { [EDGE]: owner === 'edge' ? ['*/5 * * * *'] : [], 'reader-core': owner === 'core' ? ['*/5 * * * *'] : [] },
    mcp: owner === 'edge' ? [EDGE, 'reader-core'] : [],
    ...extra
  }
  const calls: string[] = []
  const api: CloudflareApi = {
    async list<T>(pathname: string) {
      calls.push(`GET ${pathname}`)
      if (pathname === '/workflows') return structuredClone(state.workflows) as T[]
      if (pathname === '/queues') return structuredClone(state.queues) as T[]
      if (pathname === '/workers/durable_objects/namespaces')
        return [...state.mcp.map(script => ({ class: 'SlaxMcpServer', script })), { class: 'SlaxMcpServer', script: 'another-app' }] as T[]
      throw new Error(`unexpected list ${pathname}`)
    },
    async get<T>(pathname: string) {
      calls.push(`GET ${pathname}`)
      if (pathname === '/workers/scripts') return state.scripts.map(id => ({ id })) as T
      const schedule = /^\/workers\/scripts\/([^/]+)\/schedules$/.exec(pathname)
      if (schedule) return { schedules: (state.schedules[decodeURIComponent(schedule[1])] ?? []).map(cron => ({ cron })) } as T
      throw new Error(`unexpected ${pathname}`)
    },
    async send<T>(method: 'PUT' | 'DELETE', pathname: string, body?: unknown) {
      calls.push(`${method} ${pathname}`)
      const consumer = /^\/queues\/([^/]+)\/consumers\/([^/]+)$/.exec(pathname)
      if (method === 'DELETE' && consumer) {
        const queue = state.queues.find(item => item.queue_id === consumer[1])!
        queue.consumers = queue.consumers.filter(item => item.consumer_id !== consumer[2])
      } else if (method === 'PUT' && pathname === `/workers/scripts/${EDGE}/schedules`) state.schedules[EDGE] = body as string[]
      else throw new Error(`unexpected ${method} ${pathname}`)
      return {} as T
    }
  }
  // A Core deploy takes every Workflow and becomes each queue's consumer, as Wrangler does. A retire-mcp deploy
  // deletes the Worker's MCP namespace, which Cloudflare refuses while another Worker still binds to it.
  const deploy = vi.fn(async (targets: Target[], mcp: McpPhase) => {
    for (const target of targets) {
      const name = names[target]
      if (mcp === 'retire-mcp') {
        if (target === 'core' && state.mcp.includes(EDGE)) throw new Error('tombstone_delete_blocked_by_external_bindings')
        state.mcp = state.mcp.filter(script => script !== name)
      }
      if (!state.scripts.includes(name)) state.scripts.push(name)
      if (target === 'core') {
        for (const workflow of state.workflows) workflow.script_name = 'reader-core'
        for (const queue of state.queues) if (!queue.consumers.length) queue.consumers.push({ script: 'reader-core', consumer_id: `core-${queue.queue_id}`, type: 'worker' })
      }
    }
    return 0
  })
  return { state, api, calls, deploy }
}

const quiet = () => {}

describe('five-Worker topology check', () => {
  test('an untransitioned installation names every surface still owned by Edge and the transition command', async () => {
    const { state, api } = account('edge')
    const problems = topologyProblems(state, config)
    expect(problems).toContain('Worker reader-objects (objects) is not deployed')
    for (const name of workflows) expect(problems).toContain(`Workflow ${name} belongs to ${EDGE}, not reader-core`)
    for (const name of queues) expect(problems).toContain(`Queue ${name} is consumed by ${EDGE}, not only reader-core`)
    expect(problems).toContain(`Edge ${EDGE} still has cron schedules */5 * * * *`)
    for (const script of [EDGE, 'reader-core']) expect(problems).toContain(`MCP namespace SlaxMcpServer still exists on ${script}`)
    expect(problems.join('\n')).not.toContain('another-app')
    await expect(requireTopology(api, config)).rejects.toThrow('topology:transition')
  })

  test('a transitioned installation passes and a second consumer on a queue is reported', async () => {
    const { state, api } = account('core', { scripts: ['reader-browser', 'reader-objects', 'reader-core', 'reader-ai', EDGE] })
    await expect(requireTopology(api, config)).resolves.toBeUndefined()
    state.queues[0].consumers.push({ script: EDGE, consumer_id: 'again', type: 'worker' })
    expect(topologyProblems(state, config)).toEqual([`Queue ${queues[0]} is consumed by reader-core, ${EDGE}, not only reader-core`])
  })
})

describe('topology:transition', () => {
  test('dry runs read state and change nothing at every step', async () => {
    const { api, calls, deploy } = account('edge', { scripts: ['reader-browser', 'reader-objects', 'reader-core', 'reader-ai', EDGE] })
    for (const step of [1, 2, 3] as const) await transition({ step, dryRun: true, api, config, deploy, log: quiet }).catch(() => undefined)
    expect(deploy).not.toHaveBeenCalled()
    expect(calls.filter(call => !call.startsWith('GET '))).toEqual([])
  })

  test('steps 1 to 4 move every job surface to Core in order and verify it', async () => {
    const { state, api, calls, deploy } = account('edge')
    const log = vi.fn()
    expect(await transition({ step: 1, dryRun: false, api, config, deploy, log })).toBe(0)
    expect(deploy.mock.calls).toEqual([[['browser', 'objects'], 'keep-mcp']])
    await expect(transition({ step: 3, dryRun: false, api, config, deploy, log })).rejects.toThrow('Step 3 requires step 2')
    expect(await transition({ step: 2, dryRun: false, api, config, deploy, log })).toBe(0)
    const writes = calls.filter(call => !call.startsWith('GET '))
    // Edge consumers and schedules are released before Core is published, so no queue ever has two consumers.
    expect(writes).toEqual([...queues.map((_, index) => `DELETE /queues/q${index}/consumers/c${index}`), `PUT /workers/scripts/${EDGE}/schedules`])
    expect(deploy.mock.calls.slice(1)).toEqual([
      [['ai'], 'keep-mcp'],
      [['core'], 'keep-mcp']
    ])
    expect(state.mcp).toEqual([EDGE, 'reader-core'])
    expect(state.workflows.every(workflow => workflow.script_name === 'reader-core')).toBe(true)
    expect(await transition({ step: 3, dryRun: false, api, config, deploy, log })).toBe(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Repoint the newsletter Email Routing rule'))
    expect(state.mcp).toEqual([EDGE, 'reader-core'])
    expect(await transition({ step: 4, dryRun: false, api, config, deploy, log })).toBe(0)
    // Edge goes first: Cloudflare keeps Core's namespace while any Worker still binds to it.
    expect(deploy.mock.calls.slice(-2)).toEqual([
      [['edge'], 'retire-mcp'],
      [['core'], 'retire-mcp']
    ])
    expect(state.mcp).toEqual([])
    await expect(requireTopology(api, config)).resolves.toBeUndefined()
    expect(await transition({ step: 4, dryRun: false, api, config, deploy, log })).toBe(0)
    expect(deploy).toHaveBeenCalledTimes(6)
    const before = calls.length
    expect(await transition({ step: 2, dryRun: false, api, config, deploy, log })).toBe(0)
    expect(calls.slice(before).filter(call => !call.startsWith('GET '))).toEqual([])
  })

  test('step 2 refuses to run before Objects exists, and a Core that does not take ownership fails loudly', async () => {
    const missing = account('edge')
    await expect(transition({ step: 2, dryRun: false, ...missing, config, log: quiet })).rejects.toThrow('run step 1 first')
    expect(missing.deploy).not.toHaveBeenCalled()
    const stuck = account('edge', { scripts: ['reader-browser', 'reader-objects', 'reader-core', 'reader-ai', EDGE] })
    const deploy = vi.fn(async () => 0)
    await expect(transition({ step: 2, dryRun: false, api: stuck.api, config, deploy, log: quiet })).rejects.toThrow('Core did not take ownership')
  })

  test('step 4 deletes nothing while ownership is incomplete, and the dry run only plans the deletion', async () => {
    const { state, api, deploy } = account('core', { scripts: ['reader-browser', 'reader-objects', 'reader-core', 'reader-ai', EDGE], mcp: [EDGE, 'reader-core'] })
    const log = vi.fn()
    expect(await transition({ step: 4, dryRun: true, api, config, deploy, log })).toBe(0)
    expect(deploy).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(`would deploy ${EDGE} and delete its SlaxMcpServer namespace`)
    state.queues[0].consumers = [{ script: EDGE, consumer_id: 'stale', type: 'worker' }]
    expect(await transition({ step: 4, dryRun: false, api, config, deploy, log })).toBe(1)
    expect(deploy).not.toHaveBeenCalled()
    expect(state.mcp).toEqual([EDGE, 'reader-core'])
  })

  test('step 4 reports an incomplete transition without changing anything', async () => {
    const { api, calls, deploy } = account('edge')
    const log = vi.fn()
    expect(await transition({ step: 4, dryRun: false, api, config, deploy, log })).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Transition incomplete'))
    expect(calls.filter(call => !call.startsWith('GET '))).toEqual([])
    expect(deploy).not.toHaveBeenCalled()
  })
})

describe('Cloudflare API client', () => {
  test('lists read every page so a later page cannot hide an Edge consumer', async () => {
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
