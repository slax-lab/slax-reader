import type { PasskeyChallengeRequest } from '@slax-reader/contracts/passkey'
import { ErrorParam } from '@/const/err'
import { Controller } from '@/decorators/controller'
import { inject } from '@/decorators/di'
import { Get, Post } from '@/decorators/route'
import { PasskeyService } from '@/domain/passkey'
import type { ContextManager } from '@/utils/context'
import { RequestUtils } from '@/utils/requestUtils'
import { parsePasskeyEmail } from '@/utils/passkey'
import { Successed } from '@/utils/responseUtils'

@Controller('/v1/user')
export class PasskeyController {
  constructor(@inject(PasskeyService) private passkeys: PasskeyService) {}

  @Post('/passkey/challenge')
  async handlePasskeyChallengeRequest(ctx: ContextManager, request: Request) {
    const input = await RequestUtils.json<PasskeyChallengeRequest>(request)
    if (input?.purpose === 'register') {
      return Successed(await this.passkeys.challenge(ctx.env, input, ctx.getUserId()), 200, 'ok', { 'Cache-Control': 'no-store' })
    }
    if (input?.purpose !== 'login') throw ErrorParam()
    return Successed(await this.passkeys.challenge(ctx.env, { purpose: 'login', email: parsePasskeyEmail(input.email) }), 200, 'ok', { 'Cache-Control': 'no-store' })
  }

  @Get('/passkey')
  async handleUserPasskeyListRequest(ctx: ContextManager, _request: Request) {
    return Successed(await this.passkeys.list(ctx.env, ctx.getUserId()), 200, 'ok', { 'Cache-Control': 'no-store' })
  }
}
