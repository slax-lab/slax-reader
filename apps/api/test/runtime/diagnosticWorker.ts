import core from '../../src/entry/core/index'
import { container } from '../../src/decorators/di'
import { initializeInfrastructure } from '../../src/di/generated/dependency'
import { ContextManager } from '../../src/utils/context'
import { UserDeletionService } from '../../src/domain/userDeletion'
export { SlaxJieba, SlaxWebSocketServer, SlaxMcpServer, ScreenshotBrowser } from '../../src/entry/core/index'

const sink = 'https://diagnostic-capture.fixture.invalid/report'
const messages: string[] = []
let failNotification = false
const originalFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  if (url !== sink) return originalFetch(input, init)
  if (failNotification) return Promise.resolve(new Response('fixture notification rejected', { status: 503 }))
  messages.push(String(init?.body))
  return Promise.resolve(new Response('{"code":0}'))
}) as typeof fetch

export default {
  async fetch(request: Request, env: Env, execution: ExecutionContext) {
    const url = new URL(request.url)
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)
    const contentBinding = url.hostname === 'content.internal' && url.pathname.startsWith('/content/')
    if (!local && !contentBinding) return new Response('Local fixture only', { status: 403 })
    if (url.pathname === '/__fixture/diagnostic-object-missing') return Response.json((await env.DIAGNOSTICS!.head(url.searchParams.get('key')!)) === null)
    if (url.pathname === '/__fixture/diagnostic-notifications') return Response.json(messages)
    if (url.pathname === '/__fixture/diagnostic-notification-failure') {
      failNotification = true
      return new Response('ok')
    }
    const fixtureEnv = { ...env, RUN_TYPE: 'beta', REPORT_PUSH_API: sink } as Env
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
