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
    console.error(`[s] resolve ${code} failed:`, error)
  }

  console.log(`[s] resolve ${code} to ${uuid}`)

  if (!uuid) {
    throw createError({ statusCode: 404, statusMessage: 'Share not found' })
  }

  return sendRedirect(event, `/b/${uuid}`, 302)
})
