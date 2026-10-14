<template>
  <div class="terms">
    <main>
      <div class="terms-wrapper">
        <ContentRenderer v-if="page" :value="page" />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { Collections } from '@nuxt/content'

const { locale, t } = useI18n()

// 使用 useHead 设置动态标题,而不是 definePageMeta
useHead({
  title: t('docs.title.terms')
})

const { data: page } = await useAsyncData(
  'terms',
  async () => {
    const collection = ('open_docs_' + locale.value) as keyof Collections

    const content = await queryCollection(collection).path('/terms').first()

    if (!content && locale.value !== 'en') {
      return await queryCollection('open_docs_en').path('/terms').first()
    }

    return content
  },
  {
    watch: [locale]
  }
)
</script>

<style lang="scss" scoped>
@use '~~/styles/markdown/content.scss' as markdownContent;

.terms {
  main {
    --style: py-40px px-20px flex-center;
    background: var(--slax-bg);

    .terms-wrapper {
      --style: max-w-800px;
      @include markdownContent.contentStyle;
    }
  }
}
</style>
