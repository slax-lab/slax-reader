import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { EmailAuthUnavailableError, ErrorParam, OAuth2StateExpiredError, UnauthorizedError } from '@/const/err'
import { UserRepo } from '@/infra/repository/dbUser'
import { RedisClient } from '@/infra/repository/redisClient'
import { SlaxAuth } from '@/utils/auth'
import type { ContextManager } from '@/utils/context'
import type { EmailAuthIdentities, EmailAuthProviderChallenge } from '@slax-reader/contracts/email-auth'
import { z } from 'zod'
import { EmailCodeService } from './emailCode'
import { UserService } from './user'

const address = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform(value => {
    const at = value.lastIndexOf('@')
    return value.slice(0, at) + value.slice(at).toLowerCase()
  })
  .refine(value => !/@(?:appleid\.apple\.com|deleted\.invalid)$/.test(value))
const sendSchema = z.object({ email: address, locale: z.string().max(32).optional() })
const verifySchema = z.object({
  email: address,
  request_id: z
    .string()
    .min(16)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/),
  code: z.string().regex(/^\d{6}$/),
  auth_attribution: z.unknown().optional()
})
const providerSchema = z.object({ type: z.enum(['google', 'apple']), platform: z.enum(['web', 'ios', 'android']) })
const providerFinishSchema = providerSchema.extend({
  state: z.string().regex(/^link\.[0-9a-f-]{36}$/),
  code: z.string().min(1).max(8192),
  id_token: z.string().max(8192).optional(),
  client_id: z.string().max(256).optional(),
  redirect_uri: z.string().max(2048)
})

async function parse<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const result = schema.safeParse(await request.json().catch(() => null))
  if (!result.success) throw ErrorParam()
  return result.data
}

export function emailAuthEnabled(env: Env): boolean {
  return env.EMAIL_AUTH_ENABLED === 'true' && Boolean(env.RESEND_API_KEY?.trim()) && (env.EMAIL_AUTH_HMAC_SECRET?.trim().length ?? 0) >= 32
}

function requireEmailAuth(env: Env) {
  if (!emailAuthEnabled(env)) throw EmailAuthUnavailableError()
}

function owner(ctx: ContextManager): number {
  const id = ctx.getUserId()
  if (!Number.isSafeInteger(id) || id < 1) throw UnauthorizedError()
  return id
}

type ProviderState = z.infer<typeof providerSchema> & { nonce: string }

@injectable()
export class EmailAuthentication {
  constructor(
    @inject(UserRepo) private users: UserRepo,
    @inject(UserService) private userService: UserService,
    @inject(RedisClient) private redis: LazyInstance<RedisClient>
  ) {}

  async identities(ctx: ContextManager): Promise<EmailAuthIdentities> {
    const bindings = await this.users.getUserBindPlatform(owner(ctx))
    return {
      enabled: emailAuthEnabled(ctx.env),
      email: bindings.find(item => item.platform === 'mail')?.user_name ?? null,
      google: bindings.some(item => item.platform === 'google'),
      apple: bindings.some(item => item.platform === 'apple')
    }
  }

  async send(ctx: ContextManager, request: Request, purpose: 'login' | 'bind') {
    requireEmailAuth(ctx.env)
    const { email, locale } = await parse(request, sendSchema)
    const userId = purpose === 'bind' ? owner(ctx) : undefined
    const emailKey = email.toLowerCase()
    const deliveryEmail = purpose === 'login' ? ((await this.users.getLoginEmailRecipient(emailKey)) ?? email) : email
    return new EmailCodeService(ctx.env, this.redis()).sendCode({
      purpose,
      emailKey,
      deliveryEmail,
      clientIp: request.headers.get('CF-Connecting-IP') ?? 'unknown',
      userId,
      locale: locale ?? request.headers.get('Accept-Language')?.split(',')[0]
    })
  }

  private async consume(ctx: ContextManager, request: Request, purpose: 'login' | 'bind', userId?: number) {
    requireEmailAuth(ctx.env)
    const { email, request_id, code, auth_attribution } = await parse(request, verifySchema)
    const key = email.toLowerCase()
    const delivery = await new EmailCodeService(ctx.env, this.redis()).verifyCode({ purpose, emailKey: key, requestId: request_id, code, userId })
    return { key, delivery, auth_attribution }
  }

  async login(ctx: ContextManager, request: Request) {
    const { key, delivery, auth_attribution } = await this.consume(ctx, request, 'login')
    return this.userService.loginByVerifiedEmail(ctx, request, key, delivery, auth_attribution)
  }

  async bindEmail(ctx: ContextManager, request: Request) {
    const userId = owner(ctx)
    const { key, delivery } = await this.consume(ctx, request, 'bind', userId)
    await this.users.bindLoginEmail(userId, key, delivery)
    return { email: delivery }
  }

  private providerState(ctx: ContextManager, state: string) {
    return this.redis().key<ProviderState>(`auth:provider:${ctx.env.RUN_TYPE}:${owner(ctx)}:${state}`)
  }

  async startProvider(ctx: ContextManager, request: Request): Promise<EmailAuthProviderChallenge> {
    requireEmailAuth(ctx.env)
    const { type, platform } = await parse(request, providerSchema)
    if (type === 'apple' && platform === 'android') throw ErrorParam()
    const state = `link.${crypto.randomUUID()}`
    const nonce = (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '')
    await this.providerState(ctx, state).setWithExpire({ type, platform, nonce }, 600)
    return { state, nonce }
  }

  async finishProvider(ctx: ContextManager, request: Request) {
    requireEmailAuth(ctx.env)
    const input = await parse(request, providerFinishSchema)
    if (input.platform === 'web' && input.redirect_uri !== (ctx.env.EMAIL_AUTH_WEB_CALLBACK || new URL('/auth', ctx.env.FRONT_END_URL).href)) throw ErrorParam()
    if (input.platform !== 'web' && input.redirect_uri !== '') throw ErrorParam()
    const challenge = await this.providerState(ctx, input.state).consume()
    if (!challenge || challenge.type !== input.type || challenge.platform !== input.platform) throw OAuth2StateExpiredError()
    const identity = await new SlaxAuth(ctx.env).login(input)
    if (!identity.sub || identity.nonce !== challenge.nonce) throw OAuth2StateExpiredError()
    await this.users.bindLoginProvider(owner(ctx), input.type, identity.sub, identity.email)
    return { linked: true }
  }
}
