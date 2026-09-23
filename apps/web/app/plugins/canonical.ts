export default defineNuxtPlugin(() => {
  const route = useRoute()
  const config = useRuntimeConfig()

  watch(
    () => route.fullPath,
    () => {
      const baseUrl = config.public.PUBLIC_BASE_URL || 'https://r.slax.com'
      const canonicalUrl = `${baseUrl}${route.path}/` // 不包含查询参数

      // 更新 head 中的规范标记
      useHead({
        link: [
          {
            rel: 'canonical',
            href: canonicalUrl,
            key: 'canonical'
          }
        ]
      })
    },
    { immediate: true }
  )
})
