<template>
  <div class="collection-feed">
    <ClientOnly>
      <WindowVirtualizer :key="collectionCode" :data="feedItems">
        <template #default="{ item, index }">
          <NuxtLink
            :key="String(item.id)"
            class="cfeed-card"
            :to="eventEntryUrl(`/b/${item.id}`, 'inbox_collection')"
            data-analytics-element="bookmark_list_row"
            target="_blank"
            rel="noopener"
            :aria-label="$t('page.bookmarks_index.collection_feed.open_article', { title: item.displayTitle })"
          >
            <span class="cfeed-index">{{ index + 1 }}</span>
            <div class="cfeed-body">
              <div class="cfeed-title">{{ item.displayTitle }}</div>

              <div v-if="item.first_mark && item.first_mark.comment" class="cfeed-highlight">
                <img class="cfeed-avatar" :src="authorAvatar || defaultAvatar" alt="" />
                <div class="cfeed-highlight-text">
                  <p v-if="item.first_mark.comment" class="cfeed-note">{{ item.first_mark.comment }}</p>
                </div>
              </div>

              <div class="cfeed-meta">
                <span v-if="item.date" class="cfeed-date">{{ item.date }}</span>
                <span v-if="item.mark_count > 0" class="cfeed-count">
                  {{ $t('page.bookmarks_index.collection_feed.highlight_count', { count: item.mark_count }) }}
                </span>
                <span v-if="item.site_name || item.host_url" class="cfeed-source">{{ item.site_name || item.host_url }}</span>
              </div>
            </div>
          </NuxtLink>
        </template>
      </WindowVirtualizer>
      <template #fallback>
        <NuxtLink
          v-for="(item, i) in feedItems.slice(0, 20)"
          :key="String(item.id)"
          class="cfeed-card"
          :to="eventEntryUrl(`/b/${item.id}`, 'inbox_collection')"
          data-analytics-element="bookmark_list_row"
          target="_blank"
          rel="noopener"
          :aria-label="$t('page.bookmarks_index.collection_feed.open_article', { title: item.displayTitle })"
        >
          <span class="cfeed-index">{{ i + 1 }}</span>
          <div class="cfeed-body">
            <div class="cfeed-title">{{ item.displayTitle }}</div>

            <div v-if="item.first_mark && item.first_mark.comment" class="cfeed-highlight">
              <img class="cfeed-avatar" :src="authorAvatar || defaultAvatar" alt="" />
              <div class="cfeed-highlight-text">
                <p v-if="item.first_mark.comment" class="cfeed-note">{{ item.first_mark.comment }}</p>
              </div>
            </div>

            <div class="cfeed-meta">
              <span v-if="item.date" class="cfeed-date">{{ item.date }}</span>
              <span v-if="item.mark_count > 0" class="cfeed-count">
                {{ $t('page.bookmarks_index.collection_feed.highlight_count', { count: item.mark_count }) }}
              </span>
              <span v-if="item.site_name || item.host_url" class="cfeed-source">{{ item.site_name || item.host_url }}</span>
            </div>
          </div>
        </NuxtLink>
      </template>
    </ClientOnly>
  </div>
</template>

<script lang="ts" setup>
import type { CollectionBookmarkItem } from '@/composables/bookmark/useLocalCollections'
import { WindowVirtualizer } from 'virtua/vue'

const props = defineProps<{ bookmarks: CollectionBookmarkItem[]; authorAvatar?: string; collectionCode?: string }>()

const defaultAvatar = new URL('@images/user-default-avatar.png', import.meta.url).href

const feedItems = computed(() => {
  return props.bookmarks.map(bookmark => ({
    ...bookmark,
    displayTitle: truncateTitle(bookmark.alias_title || bookmark.title, 48) || bookmark.target_url,
    // 所划线引用的内容
    previewText: markText(bookmark.first_mark?.content),
    // 展示时间用 starred_at
    date: (bookmark.starred_at || '').slice(0, 10)
  }))
})
</script>

<style lang="scss" scoped>
.collection-feed {
  position: relative;
}

.cfeed-card {
  display: flex;
  align-items: flex-start;
  gap: 32px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--slax-border);
  color: inherit;
  text-decoration: none;
  transition: background 0.15s;

  &:hover,
  &:focus-visible {
    background: var(--slax-accent-bg);
  }

  &:focus-visible {
    outline: 2px solid var(--slax-accent);
    outline-offset: 2px;
  }
}

.cfeed-index {
  flex-shrink: 0;
  min-width: 24px;
  padding-top: 2px;
  text-align: right;
  font-family: var(--slax-font-serif);
  font-size: 15px;
  color: var(--slax-text-light);
  user-select: none;
}

.cfeed-body {
  flex: 1;
  min-width: 0;
  padding-right: 32px;
}

.cfeed-title {
  margin: 0 0 2px;
  font-family: var(--slax-font-serif);
  font-size: 17px;
  font-weight: 400;
  line-height: 1.45;
  letter-spacing: -0.01em;
  color: var(--slax-text);
}

.cfeed-highlight {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 720px;
  margin: 6px 0;
  padding: 5px 10px 5px 11px;
  border-left: 3px solid var(--slax-accent);
  border-radius: 0 4px 4px 0;
  background: var(--slax-accent-bg);
  color: var(--slax-text-muted);
  font-size: 13px;
  line-height: 1.5;
  overflow: hidden;
}

.cfeed-avatar {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--slax-border);
}

.cfeed-highlight-text {
  min-width: 0;
}

.cfeed-note {
  margin: 0;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cfeed-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  color: var(--slax-text-light);
}

.cfeed-date {
  flex-shrink: 0;
  font-weight: 300;
}

.cfeed-count {
  position: relative;
  flex-shrink: 0;
  padding-left: 8px;
  font-weight: 300;
  white-space: nowrap;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    width: 1px;
    height: 12px;
    background: var(--slax-border);
    transform: translateY(-50%);
  }
}

.cfeed-source {
  min-width: 0;
  padding-left: 8px;
  border-left: 1px solid var(--slax-border);
  font-weight: 300;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
