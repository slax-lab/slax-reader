import core from '../../src/entry/core/index'
import { container } from '../../src/decorators/di'
import { initializeInfrastructure } from '../../src/di/generated/dependency'
import { ContextManager } from '../../src/utils/context'
import { UserDeletionService } from '../../src/domain/userDeletion'
import { snapshotAiProviderResponse } from './snapshotAiSmoke'
export { SlaxJieba, SlaxWebSocketServer, SlaxMcpServer, ScreenshotBrowser } from '../../src/entry/core/index'

const sink = 'https://diagnostic-capture.fixture.invalid/report'
const messages: string[] = []
const emailCodes = new Map<string, string>()
const maintenanceAdmissions: unknown[] = []
let failNotification = false
const originalFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  if (url === 'https://api.resend.com/emails') {
    const id = new Headers(init?.headers).get('Idempotency-Key')
    const code = /\b\d{6}\b/.exec(JSON.parse(String(init?.body)).text)?.[0]
    if (!id || !code) return Promise.resolve(new Response(null, { status: 400 }))
    emailCodes.set(id, code)
    return Promise.resolve(Response.json({ id }))
  }
  if (new URL(url).hostname === 'aiplatform.googleapis.com') return snapshotAiProviderResponse(new Request(input, init))
  if (url !== sink) return originalFetch(input, init)
  if (failNotification) return Promise.resolve(new Response('fixture notification rejected', { status: 503 }))
  messages.push(String(init?.body))
  return Promise.resolve(new Response('{"code":0}'))
}) as typeof fetch

export default {
  async fetch(request: Request, env: Env, execution: ExecutionContext) {
    const url = new URL(request.url)
    if (!['localhost', '127.0.0.1', 'content.internal'].includes(url.hostname)) return new Response('Local fixture only', { status: 403 })
    const aiFeature = /^\/__fixture\/snapshot-ai\/(outline|overview|chat)$/.exec(url.pathname)?.[1]
    if (aiFeature) {
      // The isolated launcher supports Edge-to-Core only. Route to the real Core AI
      // handlers here; production AiEntry delegates to the same Core worker.
      url.pathname = aiFeature === 'chat' ? '/v1/aigc/chat' : `/v1/bookmark/${aiFeature}`
      return core.fetch(new Request(url, request), { ...env, VERTEX_API_KEY: 'snapshot-ai-fixture' }, execution)
    }
    if (url.pathname === '/__fixture/diagnostic-object-missing') return Response.json((await env.DIAGNOSTICS!.head(url.searchParams.get('key')!)) === null)
    if (url.pathname === '/__fixture/diagnostic-notifications') return Response.json(messages)
    if (url.pathname === '/__fixture/email-code' && env.EMAIL_AUTH_ENABLED === 'true') {
      const id = url.searchParams.get('id') ?? ''
      const code = emailCodes.get(id)
      emailCodes.delete(id)
      return Response.json(code ?? null)
    }
    if (url.pathname === '/__fixture/diagnostic-notification-failure') {
      failNotification = true
      return new Response('ok')
    }
    if (url.pathname === '/__fixture/vector-maintenance-admissions') return Response.json(maintenanceAdmissions)
    const fixtureEnv = { ...env, RUN_TYPE: 'beta', REPORT_PUSH_API: sink } as Env
    fixtureEnv.VECTOR_V5_MAINTENANCE_WORKFLOW = {
      async create(options: { id: string; params: unknown }) {
        maintenanceAdmissions.push(options.params)
        return { id: options.id }
      },
      async createBatch(options: { id: string; params: unknown }[]) {
        maintenanceAdmissions.push(...options.map(item => item.params))
        return options.map(item => ({ id: item.id }))
      }
    } as unknown as NonNullable<Env['VECTOR_V5_MAINTENANCE_WORKFLOW']>
    fixtureEnv.USER_DELETION_QUEUE = {
      async send(body: { userId: number }) {
        const context = new ContextManager(execution, fixtureEnv),
          scope = container.clone()
        initializeInfrastructure(context, scope)
        try {
          await scope.resolve<UserDeletionService>(UserDeletionService).cleanupUserData(body.userId, fixtureEnv)
        } finally {
          await context.cleanup()
        }
      }
    } as Queue
    return core.fetch(request, fixtureEnv, execution)
  }
}
