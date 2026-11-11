import { ErrorParam, OAuth2StateExpiredError } from '@/const/err'
import { inject, injectable } from '@/decorators/di'
import { OAuthStateRepo } from '@/infra/repository/redisOAuthState'
import { SlaxAuth } from '@/utils/auth'
import type { ContextManager } from '@/utils/context'
import type { EmailAuthClientPlatform, EmailAuthProvider, EmailAuthProviderChallenge, EmailCodeInput } from '@slax-reader/contracts/email-auth'
import { EmailCodeService } from './emailCode'
import { LoginIdentityService } from './loginIdentityService'
import type { userLoginReq } from './user'

type ProviderProof = userLoginReq & { state: string }
type BindingProof = (EmailCodeInput & { type: 'email' }) | ProviderProof

@injectable()
export class LoginIdentityBindingService {
  constructor(
    @inject(LoginIdentityService) private identities: LoginIdentityService,
    @inject(EmailCodeService) private emailCodes: EmailCodeService,
    @inject(OAuthStateRepo) private oauthState: OAuthStateRepo
  ) {}

  async bind(ctx: ContextManager, value: unknown) {
    if (!value || typeof value !== 'object') throw ErrorParam()
    const proof = value as BindingProof
    const userId = ctx.getUserId()
    if (proof.type === 'email') {
      const { key, delivery } = await this.emailCodes.verifyCode(ctx.env, { ...proof, purpose: 'bind', userId })
      await this.identities.bindLoginEmail(userId, key, delivery)
      return { email: delivery }
    }

    const { type, platform, state } = proof
    if ((type !== 'google' && type !== 'apple') || typeof state !== 'string' || state.length > 128) throw ErrorParam()
    const challenge = await this.oauthState.consumeProvider(ctx.env.RUN_TYPE, userId, state)
    if (!challenge || challenge.type !== type || challenge.platform !== platform) throw OAuth2StateExpiredError()
    const identity = await new SlaxAuth(ctx.env).login(proof)
    if (!identity.sub || identity.nonce !== challenge.nonce) throw OAuth2StateExpiredError()
    await this.identities.bindLoginProvider(userId, type, identity.sub, identity.email)
    return { linked: true as const }
  }

  async startProvider(ctx: ContextManager, type: EmailAuthProvider, platform: EmailAuthClientPlatform): Promise<EmailAuthProviderChallenge> {
    const state = `link.${crypto.randomUUID()}`
    const nonce = (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '')
    await this.oauthState.saveProvider(ctx.env.RUN_TYPE, ctx.getUserId(), state, { type, platform, nonce }, 600)
    return { type, state, nonce }
  }
}
