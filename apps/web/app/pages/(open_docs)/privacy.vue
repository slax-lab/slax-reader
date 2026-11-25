<template>
  <div class="privacy">
    <main :lang="documentLocale">
      <div class="privacy-wrapper">
        <ContentRenderer v-if="page" :value="page" />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ alias: ['/:agreementLocale(en|zh)/privacy'] })
const { page, documentLocale } = await useAgreementDocument('privacy')
</script>

<style lang="scss" scoped>
@use '~~/styles/markdown/content.scss' as markdownContent;

.privacy {
  main {
    --style: py-40px px-20px flex-center;
    background: var(--slax-bg);

    .privacy-wrapper {
      --style: max-w-800px;
      @include markdownContent.contentStyle;
    }
  }
}
</style>
