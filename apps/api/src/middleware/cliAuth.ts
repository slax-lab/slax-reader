import { ContextManager } from '@/utils/context'
import { InvalidApiKeyError, ApiKeyRouteNotAllowedError } from '../const/err'
import { MultiLangError } from '@/utils/multiLangError'
import { Hashid } from '@/utils/hashids'
import { ApiKeyAuth } from '../utils/apiKeyAuth'
import { Container } from '../decorators/di'

const apiKeyAllowedRoutes: Array<{ path: string; method: string }> = [
  { path: '/v1/bookmark/add', method: 'POST' },
  { path: '/v1/bookmark/add_url', method: 'POST' },
  { path: '/v1/user/me', method: 'GET' },
  { path: '/v1/bookmark/list', method: 'GET' },
  { path: '/v1/bookmark/content', method: 'POST' },
  { path: '/v1/bookmark/metadata', method: 'GET' },
  { path: '/v1/bookmark/archive', method: 'POST' },
  { path: '/v1/bookmark/star', method: 'POST' },
  { path: '/v1/bookmark/del', method: 'POST' },
  { path: '/v1/bookmark/trash', method: 'POST' },
  { path: '/v1/bookmark/trash_revert', method: 'POST' },
  { path: '/m', method: 'GET' }
]

export function isApiKeyRouteAllowed(pathname: string, method: string): boolean {
  return apiKeyAllowedRoutes.some(route => (pathname === route.path || pathname.startsWith(route.path + '/')) && method.toUpperCase() === route.method)
}

export const authWithApiKey = async (ctx: ContextManager, request: Request, apiKey: string, container: Container) => {
  if (!isApiKeyRouteAllowed(new URL(request.url).pathname, request.method)) {
    throw ApiKeyRouteNotAllowedError()
  }

  try {
    const { userId } = await new ApiKeyAuth(container).verify(apiKey)

    const hashid = new Hashid(ctx.env)
    const enId = hashid.encodeId(userId)

    ctx.setUserInfo(userId, enId, '', '')
    ctx.setHashIds(new Hashid(ctx.env, userId))
  } catch (err: unknown) {
    console.log(`api key auth failed: ${err}`)
    if (err instanceof MultiLangError) throw err
    throw InvalidApiKeyError()
  }
}
