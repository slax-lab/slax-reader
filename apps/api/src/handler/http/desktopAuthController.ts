import { Controller } from '@/decorators/controller'
import { Post } from '@/decorators/route'
import { inject } from '@/decorators/di'
import { DesktopAuthService } from '@/domain/desktopAuth'
import { DesktopAuthError, invalidDesktopAuth } from '@/domain/desktopAuthPolicy'
import { desktopAuthBody, desktopAuthResponse, limitDesktopAuth } from '@/middleware/desktopAuth'
import { ContextManager } from '@/utils/context'
import { parseDesktopCodeRequest, parseDesktopExchangeRequest } from '@slax-reader/contracts/desktop-auth'

@Controller('/v1/auth/desktop')
export class DesktopAuthController {
  constructor(@inject(DesktopAuthService) private service: DesktopAuthService) {}
  private async run(ctx: ContextManager, request: Request, action: () => Promise<unknown>) {
    try {
      await limitDesktopAuth(request, ctx)
      return desktopAuthResponse(await action())
    } catch (error) {
      if (error instanceof DesktopAuthError) return desktopAuthResponse(error.code, error.status)
      // Do not log database/signing errors containing authorization or account data.
      return desktopAuthResponse('DESKTOP_AUTH_FAILED', 500)
    }
  }
  @Post('/code')
  async code(ctx: ContextManager, request: Request) {
    return this.run(ctx, request, async () => {
      if (!ctx.getUserId()) throw new DesktopAuthError(401, 'DESKTOP_AUTH_UNAUTHORIZED')
      const origin = request.headers.get('Origin')
      if (!origin || origin !== new URL(ctx.env.FRONT_END_URL).origin) throw invalidDesktopAuth()
      const input = parseDesktopCodeRequest(await desktopAuthBody(request))
      if (!input) throw invalidDesktopAuth()
      return this.service.issue(ctx, input)
    })
  }
  @Post('/exchange')
  async exchange(ctx: ContextManager, request: Request) {
    return this.run(ctx, request, async () => {
      // The verifier belongs to a native client, never to a browser origin.
      if (request.headers.has('Origin')) throw invalidDesktopAuth()
      const input = parseDesktopExchangeRequest(await desktopAuthBody(request))
      if (!input) throw invalidDesktopAuth()
      return this.service.exchange(ctx, input)
    })
  }
}
