<template>
  <!-- The status lines shared by the article block and the bar. One line at most: `first` wins over
       the article states, `last` shows only when none of them applies. -->
  <p v-if="first" class="yt-status" :class="{ 'is-compact': compact }"><slot name="first" /></p>
  <p v-else-if="isWorking && !timedOut" class="yt-status" :class="{ 'is-compact': compact }">
    <span class="i-svg-spinners:90-ring yt-status-spinner" aria-hidden="true"></span>
    {{ $t('component.youtube_article.preparing') }}
  </p>
  <p v-else-if="isWorking && timedOut" class="yt-status" :class="{ 'is-compact': compact }">{{ $t('component.youtube_article.timeout') }}</p>
  <p v-else-if="state?.status === 'skipped'" class="yt-status" :class="{ 'is-compact': compact }">
    {{ $t('component.youtube_article.skipped') }}
    <button v-if="state.can_generate" type="button" class="yt-status-action" :disabled="acting" @click="emit('generate')">{{ $t('component.youtube_article.generate') }}</button>
  </p>
  <p v-else-if="state?.status === 'failed'" class="yt-status" :class="{ 'is-compact': compact }">
    {{ $t('component.youtube_article.failed') }}
    <button v-if="state.can_retry" type="button" class="yt-status-action" :disabled="acting" @click="emit('retry')">{{ $t('component.youtube_article.retry') }}</button>
  </p>
  <p v-else-if="state?.status === 'limit_reached'" class="yt-status" :class="{ 'is-compact': compact }">{{ $t('component.youtube_article.limit_reached') }}</p>
  <p v-else-if="last" class="yt-status" :class="{ 'is-compact': compact }"><slot name="last" /></p>
</template>

<script lang="ts" setup>
import type { YoutubeArticleState } from '@slax-reader/contracts/interface'

defineProps<{
  state: YoutubeArticleState | null
  isWorking: boolean
  timedOut: boolean
  acting: boolean
  /** Show the `first` slot instead of every other line */
  first?: boolean
  /** Show the `last` slot when no other line applies */
  last?: boolean
  /** Slimmer action buttons, for the bar */
  compact?: boolean
}>()

const emit = defineEmits<{
  (e: 'generate'): void
  (e: 'retry'): void
}>()
</script>

<style lang="scss" scoped>
.yt-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--slax-text-light);
}

.yt-status-spinner {
  width: 1em;
  height: 1em;
}

.yt-status-action,
.yt-status :slotted(.yt-status-action) {
  padding: 4px 12px;
  border: 1px solid var(--slax-accent);
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  color: var(--slax-accent);
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.yt-status.is-compact .yt-status-action,
.yt-status.is-compact :slotted(.yt-status-action) {
  padding: 2px 12px;
}
</style>
