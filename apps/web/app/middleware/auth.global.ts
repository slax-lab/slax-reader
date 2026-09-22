import { isServer } from '@commons/frontend-utils/is'

import { useCookies } from '@vueuse/integrations/useCookies'

const { get } = useCookies()
export default defineNuxtRouteMiddleware((to, from) => {
  if (isServer) {
    return
  }

  const isAnchorLink = to.path === from.path && to.hash !== from.hash

  if (isAnchorLink) {
    return
  }

  const isFromAuth = from.fullPath.indexOf('/auth') !== -1
  const isToAuth = to.fullPath.indexOf('/auth') !== -1
  const isToLogin = to.fullPath.indexOf('/login') !== -1
  // 公开白名单：按 path 前缀匹配，避免 query/子串误命中
  const authWhiteList = [
    '/privacy',
    '/terms',
    '/guide',
    '/s',
    '/b/',
    '/c/',
    '/download',
    '/contact',
    '/pricing',
    '/how-do-i-delete-my-account',
    '/delete-account-notice',
    '/x/ext-bridge'
  ]
  const isToAuthWhiteList =
    /^\/[^/]+-reader\/?$/.test(to.path) || // [blogger]-reader 博主页
    authWhiteList.some(p => (p.endsWith('/') ? to.path.startsWith(p) : to.path === p || to.path.startsWith(`${p}/`)))

  const isSharePage = /(^|\/)b\/[^/]+\/?$/.test(to.path)

  const ignoreAuth = isToAuthWhiteList || isSharePage
  const needAuth = get ? !get(useNuxtApp().$config.public.COOKIE_TOKEN_NAME) : true

  if (needAuth) {
    if (!ignoreAuth) {
      if (!isToLogin && !isFromAuth) {
        const queryParams: Record<string, string> = {}

        queryParams.redirect = encodeURIComponent(to.fullPath ? `${location.origin}${to.fullPath}` : location?.href)

        const queryStr = Object.keys(queryParams)
          .map(key => `${key}=${queryParams[key]}`)
          .join('&')

        return navigateTo(`/login${queryStr ? `?${queryStr}` : ''}`)
      }
    }
  } else {
    if (isToLogin || isToAuth) {
      const redirectUrl = to.query.redirect as string
      if (redirectUrl) {
        return navigateTo(decodeURIComponent(redirectUrl), { external: true })
      }

      return navigateTo('/bookmarks')
    }
  }
})
