import { RESTMethodPath } from '@commons/types-pro'

export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.client) {
    return
  }

  const event = useRequestEvent()
  if (!event) {
    throw createError({ statusCode: 404, fatal: true })
  }

  const cookieHeader = event.node.req.headers.cookie || ''
  const config = useRuntimeConfig()
  const tokenCookieName = config.public.COOKIE_TOKEN_NAME as string
  const apiBase = config.public.DWEB_API_BASE_URL as string

  const tokenMatch = cookieHeader.match(new RegExp(`(?:^|;\\s*)${tokenCookieName}=([^;]+)`))
  const token = tokenMatch ? tokenMatch[1] : null

  if (!token) {
    throw createError({ statusCode: 404, fatal: true })
  }

  try {
    await $fetch(`${apiBase}${RESTMethodPath.DASHBOARD_ACCESS}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
  } catch {
    throw createError({ statusCode: 404, fatal: true })
  }
})
