// Only the upstream content and article storage are synthetic.
export default nitroApp => {
  let revision = 'first'
  nitroApp.hooks.hook('request', event => {
    if (event.path.startsWith('/api/content/offline-fixture-state/') && event.method === 'POST') {
      revision = event.path.split('/').pop()
      event.node.res.end('ok')
      return
    }
    if (!/^\/(?:b|s|api\/content)\/offline-[\w-]+/.test(event.path)) return
    event.context.cloudflare = {
      context: { waitUntil: promise => { void promise } },
      env: {
        BACKEND: {
          async trackEvent() {},
          async getBookmarkUserUuidByShareCode(code) { return code === 'offline-share' ? 'offline-public' : undefined },
          async fetch(input, init) {
            const request = new Request(input, init)
            const uuid = new URL(request.url).searchParams.get('uuid')
            const owner = request.headers.has('authorization')
            if ((!owner && uuid === 'offline-private') || revision === 'revoked') return new Response(null, { status: 404 })
            return Response.json({
              role: owner ? 'owner' : 'visitor', title: 'Offline reading fixture',
              target_url: 'https://example.invalid/article', site_name: 'Synthetic reader', bookmark_uuid: uuid,
              user_id: 1, user_info: { show_userinfo: false }, content_word_count: 2000,
              updated_at: revision === 'updated' ? '2026-11-25T01:00:00Z' : '2026-11-25T00:00:00Z',
              tags: [], first_comment: 'Account annotation sentinel', type: 'article', content_key: uuid,
              created_at: '2026-11-25T00:00:00.000Z', published_at: '2026-11-25T00:00:00.000Z',
              has_fork: false, fork: null, viewer_fork_status: null
            })
          }
        },
        OSS: { get: async key => ({ text: async () => key === 'offline-private' ? '<p>Owner-only body sentinel</p>' :
          Array.from({ length: 60 }, (_, i) => `<p>${revision} article paragraph ${i + 1}.</p>`).join('') }) }
      }
    }
  })
}
