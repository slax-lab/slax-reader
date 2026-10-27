<template>
  <span v-if="hasFork" class="fork-attribution">
    <span>{{ $t('bookmark_fork.label') }}</span>
    <NuxtLink v-if="attribution?.status === 'available'" :to="`/b/${attribution.source_bookmark_uid}`">
      {{ attribution.display_name || $t('bookmark_fork.generic_source') }}
    </NuxtLink>
    <span v-else>{{ $t(attribution?.status === 'unavailable' ? 'bookmark_fork.unavailable' : 'bookmark_fork.generic_source') }}</span>
  </span>
</template>

<script setup lang="ts">
import type { BookmarkForkAttribution } from '@slax-reader/contracts'
defineProps<{
  hasFork: boolean
  attribution?: BookmarkForkAttribution | null
}>()
</script>

<style scoped>
.fork-attribution {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  margin-inline-start: 8px;
  font-size: var(--slax-fs-tag);
  color: var(--slax-text-muted);
}
.fork-attribution a {
  color: var(--slax-accent);
  overflow-wrap: anywhere;
  padding: 4px 0;
}
.fork-attribution a:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
@media (max-width: 768px) {
  .fork-attribution {
    margin-inline-start: 0;
    display: flex;
    min-height: 44px;
  }
  .fork-attribution a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
}
</style>
