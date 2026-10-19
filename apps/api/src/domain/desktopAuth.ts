import { desktopDeployment } from './desktopAuthConfig'
import { inject, injectable } from '@/decorators/di'
import { DesktopAuthRepo } from '@/infra/repository/dbDesktopAuth'
import { UserRepo } from '@/infra/repository/dbUser'
import { Auth } from '@/utils/jwt'
import { Hashid } from '@/utils/hashids'
import type { ContextManager } from '@/utils/context'
import { issueDesktopCode, redeemDesktopCode } from './desktopAuthPolicy'
import type { DesktopCodeRequest, DesktopExchangeRequest } from '@slax-reader/contracts/desktop-auth'

@injectable()
export class DesktopAuthService {
  constructor(
    @inject(DesktopAuthRepo) private codes: DesktopAuthRepo,
    @inject(UserRepo) private users: UserRepo
  ) {}
  async issue(ctx: ContextManager, input: DesktopCodeRequest) {
    const deployment = desktopDeployment(ctx.env)
    await this.users.requireActiveUser(ctx.getUserId())
    const result = await issueDesktopCode(this.codes, input, ctx.getUserId(), deployment)
    // Expiry predicates enforce correctness; cleanup is bounded and never delays the response.
    ctx.execution.waitUntil(this.codes.cleanup().catch(() => undefined))
    return result
  }
  async exchange(ctx: ContextManager, input: DesktopExchangeRequest) {
    ctx.execution.waitUntil(this.codes.cleanup().catch(() => undefined))
    return redeemDesktopCode(this.codes, input, desktopDeployment(ctx.env), async account => {
      await this.users.requireActiveUser(account.id)
      const token = await new Auth(ctx.env).sign({ id: String(new Hashid(ctx.env).encodeId(account.id)), email: account.email, lang: account.lang, client: 'macos' })
      const payload = await new Auth(ctx.env).verify(token)
      return { token, expires_at: new Date(payload.exp! * 1000).toISOString() }
    })
  }
}
