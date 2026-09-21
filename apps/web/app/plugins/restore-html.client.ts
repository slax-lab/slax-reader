import { SSR_BODY_STRIPPED } from '~/utils/ssrBody'

export default defineNuxtPlugin({
  name: 'slax:restore-html',
  enforce: 'pre',
  setup(nuxtApp) {
    const data = nuxtApp.payload.data as Record<string, { body?: unknown } | null> | undefined
    if (!data) return

    for (const [key, record] of Object.entries(data)) {
      if (!key.startsWith('content-')) continue
      if (!record || record.body !== SSR_BODY_STRIPPED) continue

      const html = document.querySelector('.article-detail .html-text')?.innerHTML
      record.body = html ?? ''
    }
  }
})
