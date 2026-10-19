<template>
  <a v-if="info?.bookmark_uid" class="article-fork" :href="`/b/${encodeURIComponent(info.bookmark_uid)}`" :title="sourceName" :aria-label="$t('component.snapshot_article_source.fork_link_label', { name: sourceName })">
    <span class="article-fork-label">{{ $t('component.snapshot_article_source.fork_label') }}</span>
    <span class="article-fork-name">{{ sourceName }}</span>
    <span class="article-fork-external" aria-hidden="true">↗</span>
  </a>
</template>

<script setup lang="ts">
import type { BookmarkForkInfo } from '@commons/frontend-types/models'

const props = defineProps<{ info?: BookmarkForkInfo | null }>()
const { t } = useI18n()
const sourceName = computed(() => props.info?.display_name?.trim() || t('component.snapshot_article_source.anonymous_source'))
</script>

<style scoped lang="scss">
.article-fork {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: min(100%, 520px);
  width: fit-content;
  margin-top: 6px;
  padding: 3px 10px;
  color: var(--slax-text-muted);
  background: var(--slax-accent-bg);
  border-radius: 20px;
  font-size: var(--slax-fs-tag);
  text-decoration: none;
  &:hover { color: var(--slax-accent); background: color-mix(in srgb, var(--slax-accent) 10%, transparent); }
  &:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: 2px; }
}
.article-fork-label { flex-shrink: 0; }
.article-fork-name { color: var(--slax-accent); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.article-fork-external { flex-shrink: 0; font-size: 14px; line-height: 1; }

@media (max-width: 768px) { .article-fork { min-height: 44px; max-width: 100%; } }
</style>
