// Only the opt-in Nuxt test layer loads these synthetic service bindings.
// The production content loader, page, hydration, and cookie cleanup remain real.
export default nitroApp => {
  nitroApp.hooks.hook('request', event => {
    if (!/^\/(?:b|api\/content)\/session-(?:public|private|unavailable|forbidden|anonymous-401)(?:[/?]|$)/.test(event.path)) return
    event.context.cloudflare = {
      context: { waitUntil: promise => { void promise } },
      env: {
        BACKEND: {
          async trackEvent() {},
          async fetch(input, init) {
            const request = new Request(input, init)
            const uuid = new URL(request.url).searchParams.get('uuid')
            const authorization = request.headers.get('authorization')
            if (uuid === 'session-unavailable') return new Response(null, { status: 503 })
            if (uuid === 'session-forbidden') return new Response(null, { status: 403 })
            if (uuid === 'session-anonymous-401' || (authorization && authorization !== 'Bearer valid-fixture')) return new Response(null, { status: 401 })
            if (uuid === 'session-private' && !authorization) return new Response(null, { status: 404 })
            return Response.json({
              title: 'Session recovery fixture', target_url: 'https://example.invalid/fixture',
              site_name: 'Synthetic fixture', bookmark_uuid: uuid, role: authorization ? 'owner' : 'visitor',
              user_id: 1, user_info: { show_userinfo: false }, content_word_count: 8,
              tags: [], type: 'article', content_key: `fixtures/${uuid}.html`,
              created_at: '2026-11-04T00:00:00.000Z', published_at: '2026-11-04T00:00:00.000Z',
              has_fork: false, fork: null, viewer_fork_status: null
            })
          }
        },
        OSS: { get: async () => ({ text: async () => '<p id="paragraph">Public fixture content remains readable after session recovery.</p>' }) }
      }
    }
  })
}
