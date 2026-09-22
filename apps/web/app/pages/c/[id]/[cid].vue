<template>
  <div class="redirect-shim"></div>
</template>

<script lang="ts" setup>
import { type CollectionBookmarkDetail } from '@commons/types/interface'
import { RESTMethodPath } from '@commons/types'

definePageMeta({
  middleware: [
    async to => {
      const nuxtApp = useNuxtApp()
      const collectionCode = String(to.params.id)
      const cbId = String(to.params.cid)

      const detail = await request()
        .get<CollectionBookmarkDetail>({
          url: RESTMethodPath.COLLECT_BOOKMARK_DETAIL,
          query: { collection_code: collectionCode, cb_id: cbId },
          errorInterceptors: () => {}
        })
        .catch(() => null)

      // await 后须 runWithContext
      if (detail?.type === 'shortcut' && detail.target_url) {
        return nuxtApp.runWithContext(() => navigateTo(detail.target_url!, { replace: true, external: true }))
      }
      if (detail?.bookmark_uuid) {
        // 透传 query（如高亮参数）
        const search = new URLSearchParams()
        for (const [key, value] of Object.entries(to.query)) {
          if (Array.isArray(value)) {
            value.forEach(item => item != null && search.append(key, item))
          } else if (value != null) {
            search.append(key, value)
          }
        }
        const qs = search.toString()
        const target = `/b/${detail.bookmark_uuid}${qs ? `?${qs}` : ''}`
        return nuxtApp.runWithContext(() => (import.meta.server ? navigateTo(target, { redirectCode: 302, replace: true }) : navigateTo(target, { external: true, replace: true })))
      }
      return nuxtApp.runWithContext(() => navigateTo('/bookmarks', { replace: true }))
    }
  ]
})
</script>

<style lang="scss" scoped>
.redirect-shim {
  width: 100%;
  height: 100vh;
}
</style>
