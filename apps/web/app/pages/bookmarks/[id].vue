<template>
  <div class="redirect-shim"></div>
</template>

<script lang="ts" setup>
import { RESTMethodPath } from '@commons/types/const'
import type { BookmarkDetail } from '@commons/types/interface'

definePageMeta({
  middleware: [
    async to => {
      const nuxtApp = useNuxtApp()
      const bmId = Number(to.params.id)
      type BookmarkDetailWithUuid = BookmarkDetail & { bookmark_user_uuid?: string; type?: 'shortcut' | 'article'; target_url?: string }

      const detail = await request()
        .get<BookmarkDetailWithUuid>({
          url: RESTMethodPath.BOOKMARK_DETAIL,
          query: { bookmark_id: String(bmId) },
          errorInterceptors: () => {}
        })
        .catch(() => null)

      // await 后须 runWithContext
      if (detail?.type === 'shortcut' && detail.target_url) {
        return nuxtApp.runWithContext(() => navigateTo(detail.target_url!, { replace: true, external: true }))
      }
      if (detail?.bookmark_user_uuid) {
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
        const target = `/b/${detail.bookmark_user_uuid}${qs ? `?${qs}` : ''}`
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
