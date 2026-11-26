<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ClientOnly><SignInLanguageOffer /></ClientOnly>
</template>

<script setup lang="ts">
import SignInLanguageOffer from '~/components/Login/SignInLanguageOffer.vue'
</script>

<style lang="scss" scoped></style>
