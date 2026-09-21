import { SSR_BODY_STRIPPED } from '~/utils/ssrBody'

export default defineNuxtPlugin({
  name: 'slax:strip-html',
  setup(nuxtApp) {
    nuxtApp.hook('app:rendered', () => {
      const data = nuxtApp.payload.data as Record<string, { body?: unknown } | null> | undefined
      if (!data) return

      for (const [key, record] of Object.entries(data)) {
        if (!key.startsWith('content-')) continue
        if (record && typeof record.body === 'string' && record.body.length > 0) {
          record.body = SSR_BODY_STRIPPED
        }
      }
    })
  }
})
