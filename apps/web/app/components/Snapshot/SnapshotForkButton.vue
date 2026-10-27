<template>
  <div class="fork-action">
    <button type="button" class="fork-button" :class="{ 'is-saved': saved, 'is-unavailable': !ready }" :disabled="pending || saved || !ready" :aria-busy="pending" @click="submit">
      <AppIcon :name="saved ? 'snapshot.saved' : 'snapshot.save'" class="fork-icon" />
      <span>{{ $t(pending ? 'bookmark_fork.submitting' : saved ? 'bookmark_fork.saved' : 'bookmark_fork.action') }}</span>
    </button>
    <span class="sr-only" role="status" aria-live="polite">{{ error }}</span>
  </div>
</template>
<script setup lang="ts">
import AppIcon from '~/components/AppIcon.vue'

import type { BookmarkForkMetadata } from '@slax-reader/contracts'
import { useBookmarkFork } from '~/composables/bookmark/useBookmarkFork'
const props = withDefaults(defineProps<{ bookmarkUid: string; viewerForkStatus?: BookmarkForkMetadata['viewer_fork_status']; ready?: boolean }>(), { ready: true })
const emit = defineEmits<{ accepted: [] }>()
const source = toRef(props, 'bookmarkUid')
const { fork, pending, saved, error } = useBookmarkFork(source, toRef(props, 'viewerForkStatus'))
async function submit() {
  if (!props.ready) return
  const result = await fork(props.bookmarkUid)
  // A local save has not reached the server yet; an immediate detail refresh can
  // still report no copy and undo the optimistic saved state.
  if (result && !result.queued) emit('accepted')
}
</script>
<style scoped>
.fork-action {
  display: inline-flex;
  flex-shrink: 0;
}
.fork-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px;
  border: none;
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: var(--slax-text-muted);
  font-family: var(--slax-font-sans);
  font-size: var(--slax-fs-aux);
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
}
.fork-icon {
  flex-shrink: 0;
}
.fork-button:hover:not(:disabled) {
  color: var(--slax-accent);
  background: var(--slax-accent-bg);
}
.fork-button:active:not(:disabled) {
  color: var(--slax-text);
  background: var(--slax-accent-bg);
}
.fork-button:disabled {
  cursor: default;
}
.fork-button.is-saved {
  color: var(--slax-accent);
}
.fork-button.is-unavailable,
.fork-button[aria-busy="true"] {
  opacity: 0.6;
}
.fork-button[aria-busy="true"] {
  cursor: wait;
}
.fork-button:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
</style>
