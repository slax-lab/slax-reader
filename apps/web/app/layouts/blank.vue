<template>
  <div class="blank-layout">
    <NuxtPage />
    <ClientOnly><UpdateNotice /></ClientOnly>
  </div>
</template>

<script setup lang="ts">
import UpdateNotice from '~/components/Tips/UpdateNotice.vue'
</script>

<style lang="scss" scoped>
.blank-layout {
  --style: w-screen overflow-hidden;
}
</style>
