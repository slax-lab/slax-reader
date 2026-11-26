<template>
  <div class="terms">
    <main :lang="documentLocale">
      <div class="terms-wrapper">
        <ContentRenderer v-if="page" :value="page" />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ alias: ['/:agreementLocale(en|zh)/terms'] })
const { page, documentLocale } = await useAgreementDocument('terms')
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
