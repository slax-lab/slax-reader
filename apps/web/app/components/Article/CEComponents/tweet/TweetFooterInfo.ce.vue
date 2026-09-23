<template>
  <div class="tweet-footer-info">
    <span>{{ t('common.operate.comment') }} {{ replyCount }}； {{ t('common.operate.forward') }} {{ retweetCount }}； {{ t('common.operate.like') }} {{ favoriteCount }}</span>
  </div>
</template>

<script lang="ts" setup>
defineProps({
  replyCount: {
    type: Number
  },
  retweetCount: {
    type: Number
  },
  favoriteCount: {
    type: Number
  }
})

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}
</script>

<style lang="scss" scoped>
.tweet-footer-info {
  --style: mt-16px text-(meta txt-light) line-height-20px select-none;
}
</style>
