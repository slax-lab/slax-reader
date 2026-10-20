<script setup lang="ts">
import { watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRss } from "../stores/rss";
import { useLibrary } from "../stores/library";
import Icon from "./Icon.vue";
const props = defineProps<{ collapsed: boolean; page: string }>();
const emit = defineEmits<{
  rss: [id: string | null];
  collection: [id: string];
  tag: [id: string];
}>();
const rss = useRss(),
  library = useLibrary(),
  { t } = useI18n();
watch(
  () => library.auth.generation,
  () => {
    if (library.auth.user && !rss.ready && !rss.loading) void rss.load();
  },
  { immediate: true },
);
function add() {
  emit("rss", null);
  rss.adding = true;
}
</script>
<template>
  <section class="source-navigation" :aria-label="t('sources')">
    <div class="source-caption">
      <span v-if="!collapsed">{{ t("sources") }}</span
      ><button
        class="icon-button"
        :aria-label="t('follow')"
        :title="t('follow')"
        @click="add"
      >
        <Icon name="plus" :size="14" />
      </button>
    </div>
    <div class="source-scroll">
      <div v-if="rss.feeds.length && !collapsed" class="source-kind">RSS</div>
      <div v-for="feed in rss.feeds" :key="feed.id" class="source-row">
        <button
          class="source"
          :class="{
            active: props.page === 'rss' && rss.selectedFeed === feed.id,
          }"
          :title="feed.remark || feed.title"
          :aria-pressed="props.page === 'rss' && rss.selectedFeed === feed.id"
          @click="emit('rss', feed.id)"
        >
          <Icon name="rss" :size="16" /><span v-if="!collapsed">{{
            feed.remark || feed.title
          }}</span>
        </button>
        <button
          v-if="!collapsed"
          class="unfollow icon-button"
          :aria-label="`${t('unfollow')} ${feed.remark || feed.title}`"
          :disabled="rss.busy"
          @click="rss.unfollow(feed.id)"
        >
          <Icon name="close" :size="12" />
        </button>
      </div>
      <div
        v-if="library.snapshot?.collections.length && !collapsed"
        class="source-kind"
      >
        Collections
      </div>
      <button
        v-for="source in library.snapshot?.collections ?? []"
        :key="source.id"
        class="source"
        :class="{
          active:
            props.page === 'library' &&
            library.view === `collection:${source.id}`,
        }"
        :disabled="!source.available"
        :title="
          source.available
            ? source.name
            : `${source.name} · ${t('collectionUnavailable')}`
        "
        :aria-pressed="
          props.page === 'library' && library.view === `collection:${source.id}`
        "
        @click="emit('collection', source.id)"
      >
        <Icon name="book" :size="16" /><span v-if="!collapsed">{{
          source.name
        }}</span>
      </button>
      <div
        v-if="library.snapshot?.tags.length && !collapsed"
        class="source-kind"
      >
        {{ t("tags") }}
      </div>
      <button
        v-for="tag in library.snapshot?.tags ?? []"
        :key="tag.id"
        class="source"
        :class="{ active: library.selectedTags.includes(tag.id) }"
        :title="tag.name"
        :aria-pressed="library.selectedTags.includes(tag.id)"
        @click="emit('tag', tag.id)"
      >
        <Icon name="tag" :size="15" /><span v-if="!collapsed">{{
          tag.name
        }}</span
        ><Icon
          v-if="!collapsed && library.selectedTags.includes(tag.id)"
          name="check"
          :size="13"
        />
      </button>
      <button
        v-if="rss.error"
        class="source retry-source"
        :title="t('retry')"
        @click="rss.load"
      >
        <Icon name="refresh" :size="15" /><span v-if="!collapsed">{{
          t("retry")
        }}</span>
      </button>
    </div>
  </section>
</template>
<style scoped>
.source-navigation {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-top: 18px;
}
.source-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 10px;
  color: var(--desktop-muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.source-caption .icon-button {
  width: 26px;
  height: 26px;
  min-height: 26px;
  color: var(--desktop-faint);
}
.source-scroll {
  overflow: auto;
  min-height: 0;
  padding: 4px 0 8px;
}
.source-kind {
  padding: 12px 10px 5px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--desktop-muted);
}
.source-row {
  position: relative;
}
.source {
  width: 100%;
  justify-content: flex-start;
  padding: 6px 10px;
  gap: 9px;
  text-align: left;
  min-width: 0;
  font-size: 12.5px;
  border-radius: 8px;
}
.source > svg {
  flex-shrink: 0;
  color: var(--desktop-muted);
}
.source > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source.active {
  background: var(--desktop-selected);
  color: var(--desktop-accent);
  font-weight: 600;
}
.source.active > svg {
  color: var(--desktop-accent);
}
.unfollow {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  min-height: 24px;
  opacity: 0;
  background: var(--desktop-raised);
  border: 1px solid var(--desktop-border);
  color: var(--desktop-muted);
}
.source-row:hover .unfollow,
.unfollow:focus-visible {
  opacity: 1;
}
.unfollow:hover:not(:disabled) {
  color: var(--desktop-danger);
  border-color: var(--desktop-danger-soft);
}
.retry-source {
  color: var(--desktop-muted);
}
</style>
