<template>
  <div></div>
</template>

<script lang="ts" setup>
import type { BloggerInfo } from '@slax-reader/contracts/interface'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { useCookies } from '@vueuse/integrations/useCookies'

const route = useRoute()
const blogger = route.params.blogger as string

// 顶层调用 useAsyncData（Nuxt 要求）
const { data: bloggerInfo } = await useAsyncData('blogger', () =>
  request().get<BloggerInfo>({
    url: RESTMethodPath.PROMOTION_BLOGGER_INFO,
    query: { blogger }
  })
)

// 顶层初始化 cookie（与 auth.global.ts 一致）
const { get } = useCookies()

onMounted(async () => {
  const isLoggedIn = !!get(useNuxtApp().$config.public.COOKIE_TOKEN_NAME as string)

  if (isLoggedIn) {
    const params = new URLSearchParams()
    if (bloggerInfo.value?.activity_id) {
      params.set('activity_id', bloggerInfo.value.activity_id)
      params.set('activity_type', 'blogger')
      // claim=true 确保每次访问 KOC 邀请链接都会触发 alertGetSubscribe modal
      // （bookmarks 页 router.replace 会抹掉这些 query，需在抹掉前让 isClaimClick=true 生效）
      params.set('claim', 'true')
    }
    const query = params.toString()
    await navigateTo(`/bookmarks${query ? `?${query}` : ''}`, { replace: true })
  } else {
    const params = new URLSearchParams()
    params.set('blogger', blogger)
    if (bloggerInfo.value?.activity_id) {
      params.set('activity_id', bloggerInfo.value.activity_id)
      params.set('activity_type', 'blogger')
    }
    params.set('redirect', `/${blogger}-reader`)
    await navigateTo(`/login?${params.toString()}`, { replace: true })
  }
})
</script>
