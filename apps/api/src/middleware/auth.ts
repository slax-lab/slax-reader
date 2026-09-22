import { Auth } from '../utils/jwt'
import { Failed } from '../utils/responseUtils'
import { ContextManager } from '@/utils/context'
import { NotAllowedEmailError, UnauthorizedError } from '../const/err'
import { Hashid } from '@/utils/hashids'
import { authWithApiKey } from './cliAuth'
import { Container } from '../decorators/di'
import { EDGE_SECRET_HEADER, EDGE_IDENTITY_HEADER, decodeEdgeIdentity } from '../const/edge'

const needWhiteHost = ['api-reader-beta.slax.com']
const needWhitePathPrefix = ['/m/']
const whiteEmailExemptPaths = ['/static/image']
const whiteList = [
  '/v1/user/login',
  '/v1/share/detail',
  '/v1/share/mark_list',
  '/v1/user/messages',
  '/v1/bookmark/connect_changes',
  '/v1/share/collection',
  '/v1/collection/bookmark',
  '/v1/collection/owner_info',
  '/v1/test/test',
  '/v1/subscriptions/plans',
  '/ping',
  '/static/image',
  '/callback/stripe',
  '/callback/telegram',
  '/callback/redeem',
  '/callback/apple_notifications',
  '/v1/share/inline_detail',
  '/callback/bookmark_overview_tags',
  '/callback/apple_notifications',
  '/v1/promotion/blogger_info',
  '/callback/crawl_notifications',
  '/callback/twitter',
  '/events'
]
// The internal/beta and dashboard allowlist is deployment configuration, not source. Personal
// addresses must never be committed, so they are read from WHITE_EMAILS (comma-separated).
// An unset or empty value denies every gated request.
const parseWhiteEmails = (value: string | undefined): string[] =>
  value === undefined
    ? []
    : value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)

const isWhiteEmail = (env: Env, email: string): boolean => parseWhiteEmails(env.WHITE_EMAILS).includes(email)

export const isWhitelisted = (pathname: string): boolean => whiteList.some(item => pathname === item || pathname.startsWith(item + '/'))

const isWhiteEmailExempt = (pathname: string): boolean => whiteEmailExemptPaths.some(item => pathname === item || pathname.startsWith(item + '/'))

const trustEdgeIdentity = (request: Request, ctx: ContextManager): boolean => {
  const secret = ctx.env.EDGE_SHARED_SECRET
  if (!secret || request.headers.get(EDGE_SECRET_HEADER) !== secret) return false

  const raw = request.headers.get(EDGE_IDENTITY_HEADER)
  if (!raw) return false

  let id: ReturnType<typeof decodeEdgeIdentity>
  try {
    id = decodeEdgeIdentity(raw)
    if (
      !id ||
      id.audience !== 'reader' ||
      !Number.isSafeInteger(id.deId) ||
      id.deId < 1 ||
      !Number.isSafeInteger(id.enId) ||
      id.enId < 1 ||
      typeof id.email !== 'string' ||
      typeof id.lang !== 'string'
    )
      throw UnauthorizedError()
  } catch {
    throw UnauthorizedError()
  }
  ctx.setUserInfo(id.deId, id.enId, id.email, id.lang)
  ctx.setHashIds(new Hashid(ctx.env, id.deId))

  const pathname = new URL(request.url).pathname
  const host = new URL(request.url).host
  if (!isWhiteEmailExempt(pathname) && (needWhiteHost.includes(host) || needWhitePathPrefix.some(prefix => pathname.startsWith(prefix))) && !isWhiteEmail(ctx.env, id.email)) {
    throw NotAllowedEmailError()
  }
  return true
}

export const auth = async (request: Request, ctx: ContextManager, container: Container) => {
  if (trustEdgeIdentity(request, ctx)) {
    try {
      const { requireActiveUser } = await import('@/utils/activeUser')
      await requireActiveUser(container, ctx.getUserId())
    } catch (error) {
      ctx.setUserInfo(0, 0, '', '')
      ctx.setHashIds(new Hashid(ctx.env))
      throw error
    }
    return
  }

  const authorization = request.headers.get('Authorization') ?? ''
  const apiKey = request.headers.get('X-API-Key') ?? ''
  const pathname = new URL(request.url).pathname

  if (isWhitelisted(pathname) && authorization === '' && apiKey === '') {
    ctx.setHashIds(new Hashid(ctx.env))
    return
  }

  if (apiKey !== '') {
    await authWithApiKey(ctx, request, apiKey, container)
    return
  }

  if (authorization === '') throw UnauthorizedError()
  try {
    await authToken(ctx, authorization.replace('Bearer ', ''))
    const { requireActiveUser } = await import('@/utils/activeUser')
    await requireActiveUser(container, ctx.getUserId())
    if (!isWhiteEmailExempt(pathname) && needWhiteHost.includes(new URL(request.url).host) && !isWhiteEmail(ctx.env, ctx.getUserEmail())) throw NotAllowedEmailError()
    if (needWhitePathPrefix.some(prefix => pathname.startsWith(prefix)) && !isWhiteEmail(ctx.env, ctx.getUserEmail())) throw NotAllowedEmailError()
  } catch (err) {
    ctx.setUserInfo(0, 0, '', '')
    ctx.setHashIds(new Hashid(ctx.env))
    console.log(`auth failed: ${err}`)
    throw UnauthorizedError()
  }
}

export const authToken = async (ctx: ContextManager, token: string) => {
  try {
    let res = await new Auth(ctx.env).verify(token)
    const enId = parseInt(res.id)
    if (!enId || isNaN(enId) || enId < 1) throw Failed(UnauthorizedError())

    const deId = new Hashid(ctx.env).decodeId(enId)
    if (!deId || isNaN(deId) || deId < 1) throw Failed(UnauthorizedError())

    ctx.setUserInfo(deId, enId, res.email, res.lang)
    ctx.setHashIds(new Hashid(ctx.env, deId))
  } catch (err) {
    console.log(`auth failed: ${err}`)
    throw UnauthorizedError()
  }
}
