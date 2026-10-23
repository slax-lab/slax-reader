<template>
  <div class="fork-action">
    <button class="fork-button" :disabled="pending || saved" :aria-busy="pending" @click="fork(bookmarkUid)">
      {{ $t(pending ? 'bookmark_fork.submitting' : saved ? 'bookmark_fork.saved' : 'bookmark_fork.action') }}
    </button>
    <span class="sr-only" role="status" aria-live="polite">{{ error }}</span>
  </div>
</template>
<script setup lang="ts">
import { useBookmarkFork, useBookmarkForkMetadata } from '~/composables/bookmark/useBookmarkFork'
const props = defineProps<{ bookmarkUid: string }>()
const source = toRef(props, 'bookmarkUid')
const { fork, pending, saved, error } = useBookmarkFork(source)
useBookmarkForkMetadata(source)
</script>
<style scoped>
.fork-action {
  display: inline-flex;
}
.fork-button {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  font-size: var(--slax-fs-aux);
  white-space: nowrap;
  cursor: pointer;
}
.fork-button:hover:not(:disabled) {
  background: var(--slax-accent-bg);
}
.fork-button:disabled {
  opacity: 0.6;
  cursor: default;
}
.fork-button[aria-busy="true"] {
  cursor: wait;
}
.fork-button:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
</style>
