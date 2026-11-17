// The production Nuxt page, content loader, renderer and router remain real.
export default nitroApp => {
  nitroApp.hooks.hook('request', event => {
    if (!/^\/(?:b|api\/content)\/reader-(?:[a-z-]+)(?:[/?]|$)/.test(event.path)) return
    event.context.cloudflare = {
      context: { waitUntil: promise => { void promise } },
      env: {
        BACKEND: {
          async trackEvent() {},
          async fetch(input, init) {
            const request = new Request(input, init)
            const uuid = new URL(request.url).searchParams.get('uuid')
            return Response.json({
              title: 'Reader startup ' + uuid, target_url: 'https://example.invalid/reader',
              site_name: 'Synthetic reader', bookmark_uuid: uuid, role: request.headers.has('authorization') ? 'owner' : 'visitor',
              user_id: 1, user_info: { show_userinfo: false }, content_word_count: 10000,
              tags: [], type: 'article', content_key: `fixtures/${uuid}.html`,
              outline: uuid.includes('outline') ? '- [40](#Passage 40.)' : '',
              created_at: '2026-11-17T00:00:00.000Z', published_at: '2026-11-17T00:00:00.000Z',
              has_fork: false, fork: null, viewer_fork_status: null
            })
          }
        },
        OSS: { get: async key => ({ text: async () => Array.from({ length: 100 }, (_, index) => `<p id="passage-${index + 1}">Passage ${index + 1}. ${'A long readable paragraph lets us observe the same passage before and after delayed client startup. '.repeat(12)}</p>${index === 4 && key.includes('image') ? '<img src="/reader-delayed.svg" width="800" height="400" alt="Synthetic delayed image">' : ''}`).join('') }) }
      }
    }
  })
}
