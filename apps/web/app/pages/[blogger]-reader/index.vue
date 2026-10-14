<template>
  <div></div>
</template>

<script lang="ts" setup>
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { BloggerInfo } from '@slax-reader/contracts/interface'
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
      // The layout coordinator captures this invitation before cleaning the root URL.
      params.set('claim', 'true')
    }
    const query = params.toString()
    await navigateTo(`/${query ? `?${query}` : ''}`, { replace: true })
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
