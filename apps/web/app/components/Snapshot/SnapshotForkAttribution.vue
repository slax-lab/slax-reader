<template>
  <NuxtLink v-if="hasFork && attribution?.status === 'available'" class="fork-attribution fork-link" :to="`/b/${attribution.source_bookmark_uid}`">
    <span class="fork-icon i-solar:git-fork-linear" aria-hidden="true" />
    <I18nT class="fork-label" keypath="bookmark_fork.saved_from" tag="span" scope="global">
      <template #name>
        <span class="fork-name" :title="sourceName">{{ sourceName }}</span>
      </template>
    </I18nT>
  </NuxtLink>
  <span v-else-if="hasFork" class="fork-attribution">
    <span class="fork-icon i-solar:git-fork-linear" aria-hidden="true" />
    {{ t(attribution?.status === 'unavailable' ? 'bookmark_fork.unavailable' : 'bookmark_fork.pending_source') }}
  </span>
</template>

<script setup lang="ts">
import type { BookmarkForkAttribution } from '@slax-reader/contracts'
import { I18nT } from 'vue-i18n'

const props = defineProps<{
  hasFork: boolean
  attribution?: BookmarkForkAttribution | null
}>()

const { t } = useI18n()
const sourceName = computed(() => (props.attribution?.status === 'available' && props.attribution.display_name) || t('bookmark_fork.generic_source'))
</script>

<style scoped>
.fork-attribution {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  font-size: var(--slax-fs-tag);
  color: var(--slax-text-muted);
  white-space: nowrap;
  text-decoration: none;
}

.fork-icon {
  flex: none;
  width: 14px;
  height: 14px;
}

.fork-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.fork-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: var(--slax-accent);
}

.fork-link:hover .fork-name {
  text-decoration: underline;
}

.fork-link:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}

@media (max-width: 768px) {
  .fork-link {
    min-height: 44px;
  }
}
</style>
