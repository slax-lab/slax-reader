<template>
  <div v-if="status === 'pending' || status === 'error'" class="subscription-status" :aria-busy="status === 'pending'">
    <p v-if="status === 'pending'" role="status">{{ $t('page.bookmarks_detail.subscription_checking') }}</p>
    <template v-else>
      <p role="alert">{{ $t('page.bookmarks_detail.subscription_check_failed') }}</p>
      <button type="button" @click="$emit('retry')">{{ $t('pdf.retry') }}</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { SubscriptionStatus } from '~/composables/useUserRelative'
defineProps<{ status: SubscriptionStatus }>()
defineEmits<{ retry: [] }>()
</script>

<style scoped>
.subscription-status { padding: 24px; color: var(--slax-text-muted); font-size: var(--slax-fs-aux); }
button { min-height: 44px; padding: 0 12px; border: 1px solid var(--slax-border); border-radius: var(--slax-radius-sm); background: var(--slax-surface-solid); color: var(--slax-accent); cursor: pointer; }
button:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: 2px; }
</style>
