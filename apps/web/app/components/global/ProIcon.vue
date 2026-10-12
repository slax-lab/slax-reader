<template>
  <div class="pro-icon" v-if="isSubscribed || isProcessing">
    <span v-if="isSubscribed">Pro</span>
    <span v-else-if="isProcessing">{{ loadingTitle }}</span>
  </div>
</template>

<script lang="ts" setup>
const { t } = useI18n()
const { loadingTitle, isSubscribed, isProcessing } = useSubscribeChecking({
  loadingText: t('component.pro_icon.processing')
})
</script>

<style lang="scss" scoped>
.pro-icon {
  --style: inline-block px-6px h-20px flex-center rounded-6px bg-gradient-to-br from-payment-success-grad-from to-chart-primary text-(12px txt-btn) relative;
}
</style>
