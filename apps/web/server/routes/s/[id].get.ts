export default defineEventHandler(async event => {
  const code = getRouterParam(event, 'id')
  if (!code) throw createError({ statusCode: 400, message: 'missing share_code' })

  // 窄化取 BACKEND，绕开 cloudflare.env 递归类型
  const { BACKEND } = event.context.cloudflare.env as unknown as {
    BACKEND: { getBookmarkUserUuidByShareCode: (code: string) => Promise<string | undefined> }
  }

  let uuid: string | undefined
  try {
    uuid = await BACKEND.getBookmarkUserUuidByShareCode(code)
  } catch (error) {
    throw createError({ statusCode: 502, statusMessage: 'Share lookup failed', cause: error })
  }

  console.log(`[s] resolve ${code} to ${uuid}`)

  if (!uuid) {
    throw createError({ statusCode: 404, statusMessage: 'Share not found' })
  }

  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  if (getHeader(event, 'accept') === 'application/json') return { uuid }
  // The first share navigation can precede worker installation. Pass its alias
  // only to the canonical reader so both previously visited URLs reopen offline.
  setCookie(event, 'slax-share-entry', code, { path: '/b/' + uuid, maxAge: 90, sameSite: 'lax' })
  return sendRedirect(event, `/b/${uuid}`, 302)
})
