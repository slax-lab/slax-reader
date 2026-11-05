import { defineEventHandler, getQuery, sendRedirect, setCookie } from 'h3'

export default defineEventHandler(event => {
  const scenario = getQuery(event).scenario === 'private' ? 'private' : 'public'
  setCookie(event, 'slax_test', 'expired-fixture', { path: '/', sameSite: 'lax' })
  return sendRedirect(event, `/b/session-${scenario}?verification=expired-cookie#paragraph`)
})
