import { inject, injectable } from '@/decorators/di'
import { EmailAuthUnavailableError, ErrorParam, OAuth2StateExpiredError, UnauthorizedError } from '@/const/err'
import { UserRepo } from '@/infra/repository/dbUser'
import { AuthChallengeRepo } from '@/infra/repository/authChallengeRepo'
import { SlaxAuth } from '@/utils/auth'
import type { ContextManager } from '@/utils/context'
import { resolveDeviceId } from '@/utils/eventContext'
import type { EmailAuthIdentities, EmailAuthProviderChallenge } from '@slax-reader/contracts/email-auth'
import { z } from 'zod'
import { EmailCodeService } from './emailCode'

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
const sendSchema = z.object({ email: address, locale: z.string().max(32).optional(), purpose: z.enum(['login', 'bind']).default('login') })
const verifySchema = z.object({
  email: address,
  request_id: z
    .string()
    .min(16)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/),
  code: z.string().regex(/^\d{6}$/)
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
  return parseInput(await request.json().catch(() => null), schema)
}

function parseInput<T>(input: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(input)
  if (!result.success) throw ErrorParam()
  return result.data
}

export function emailAuthEnabled(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim()) && (env.EMAIL_AUTH_HMAC_SECRET?.trim().length ?? 0) >= 32
}

function requireEmailAuth(env: Env) {
  if (!emailAuthEnabled(env)) throw EmailAuthUnavailableError()
}

function owner(ctx: ContextManager): number {
  const id = ctx.getUserId()
  if (!Number.isSafeInteger(id) || id < 1) throw UnauthorizedError()
  return id
}

@injectable()
export class EmailAuthentication {
  constructor(
    @inject(UserRepo) private users: UserRepo,
    @inject(AuthChallengeRepo) private challenges: AuthChallengeRepo
  ) {}

  identities(ctx: ContextManager, bindings: Awaited<ReturnType<UserRepo['getUserBindPlatform']>>): EmailAuthIdentities {
    const enabled = emailAuthEnabled(ctx.env)
    return {
      enabled,
      show_email_binding: enabled && ctx.env.RUN_TYPE === 'dev',
      email: bindings.find(item => item.platform === 'mail')?.user_name ?? null,
      google: bindings.some(item => item.platform === 'google'),
      apple: bindings.some(item => item.platform === 'apple')
    }
  }

  async send(ctx: ContextManager, request: Request) {
    requireEmailAuth(ctx.env)
    const { email, locale, purpose } = await parse(request, sendSchema)
    const userId = purpose === 'bind' ? owner(ctx) : undefined
    const deviceId = resolveDeviceId(request)
    if (!deviceId || deviceId.length > 128) throw ErrorParam()
    const emailKey = email.toLowerCase()
    const deliveryEmail = purpose === 'login' ? ((await this.users.getLoginEmailRecipient(emailKey)) ?? email) : email
    return new EmailCodeService(ctx.env, this.challenges).sendCode({
      purpose,
      emailKey,
      deliveryEmail,
      clientIp: request.headers.get('CF-Connecting-IP') ?? 'unknown',
      deviceId,
      userId,
      locale: locale ?? request.headers.get('Accept-Language')?.split(',')[0]
    })
  }

  async verifyEmail(ctx: ContextManager, input: unknown, purpose: 'login' | 'bind', userId?: number) {
    requireEmailAuth(ctx.env)
    const { email, request_id, code } = parseInput(input, verifySchema)
    const key = email.toLowerCase()
    const delivery = await new EmailCodeService(ctx.env, this.challenges).verifyCode({ purpose, emailKey: key, requestId: request_id, code, userId })
    return { key, delivery }
  }

  async bind(ctx: ContextManager, request: Request) {
    const userId = owner(ctx)
    const input = await request.json().catch(() => null)
    if (input?.type === 'email') {
      const { key, delivery } = await this.verifyEmail(ctx, input, 'bind', userId)
      await this.users.bindLoginEmail(userId, key, delivery)
      return { email: delivery }
    }
    return this.finishProvider(ctx, input, userId)
  }

  async startProvider(ctx: ContextManager, input: unknown): Promise<EmailAuthProviderChallenge> {
    requireEmailAuth(ctx.env)
    const { type, platform } = parseInput(input, providerSchema)
    if (type === 'apple' && platform === 'android') throw ErrorParam()
    const state = `link.${crypto.randomUUID()}`
    const nonce = (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '')
    await this.challenges.saveProvider(ctx.env.RUN_TYPE, owner(ctx), state, { type, platform, nonce }, 600)
    return { state, nonce }
  }

  private async finishProvider(ctx: ContextManager, proof: unknown, userId: number) {
    requireEmailAuth(ctx.env)
    const input = parseInput(proof, providerFinishSchema)
    if (input.platform === 'web' && input.redirect_uri !== (ctx.env.EMAIL_AUTH_WEB_CALLBACK || new URL('/auth', ctx.env.FRONT_END_URL).href)) throw ErrorParam()
    if (input.platform !== 'web' && input.redirect_uri !== '') throw ErrorParam()
    const challenge = await this.challenges.consumeProvider(ctx.env.RUN_TYPE, userId, input.state)
    if (!challenge || challenge.type !== input.type || challenge.platform !== input.platform) throw OAuth2StateExpiredError()
    const identity = await new SlaxAuth(ctx.env).login(input)
    if (!identity.sub || identity.nonce !== challenge.nonce) throw OAuth2StateExpiredError()
    await this.users.bindLoginProvider(userId, input.type, identity.sub, identity.email)
    return { linked: true as const }
  }
}
