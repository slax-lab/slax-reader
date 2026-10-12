<template>
  <div class="delete-account-notice">
    <main>
      <div class="language-tabs">
        <button :class="['language-tab', { active: currentLang === 'zh' }]" @click="currentLang = 'zh'">中文</button>
        <button :class="['language-tab', { active: currentLang === 'en' }]" @click="currentLang = 'en'">English</button>
      </div>
      <div class="delete-account-notice-wrapper">
        <ContentRenderer v-if="currentPage" :value="currentPage" />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()

const currentLang = ref<'zh' | 'en'>('zh')

const { data: zhPage } = await useAsyncData('delete-account-notice-zh', async () => {
  return await queryCollection('open_docs_zh').path('/delete-account-notice').first()
})

const { data: enPage } = await useAsyncData('delete-account-notice-en', async () => {
  return await queryCollection('open_docs_en').path('/delete-account-notice').first()
})

const currentPage = computed(() => {
  return currentLang.value === 'zh' ? zhPage.value : enPage.value
})

const title = t('docs.title.delete_account_notice')

useHead({
  titleTemplate: `${title} - ${$t('common.app.name')}`
})
</script>

<style lang="scss" scoped>
@use '~~/styles/markdown/content.scss' as markdownContent;

.delete-account-notice {
  main {
    --style: py-40px px-20px flex-center flex-col;
    background: var(--slax-bg);

    .language-tabs {
      --style: flex justify-center items-center gap-12px mb-32px w-full;

      .language-tab {
        --style: py-10px px-24px border-none bg-transparent rounded-20px cursor-pointer text-15px font-500 line-height-1 whitespace-nowrap min-w-100px text-center h-40px
          inline-flex items-center justify-center;
        color: var(--slax-text-muted);
        transition: all var(--slax-dur-normal);

        &:hover {
          color: var(--slax-accent);
          --style: transform-scale-105;
        }

        &.active {
          background: var(--slax-accent-bg);
          color: var(--slax-accent);
          --style: font-600;
        }
      }
    }

    .delete-account-notice-wrapper {
      --style: w-full max-w-800px p-10px;
      @include markdownContent.contentStyle;
    }
  }
}
</style>
