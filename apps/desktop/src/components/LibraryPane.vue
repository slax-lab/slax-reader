<script lang="ts">
import type { Bookmark } from "../ipc/generated";
const formatters = new Map<string, Intl.DateTimeFormat>(),
  meta = new WeakMap<Bookmark, { language: string; host: string; date: string }>();
function formatter(language: string) {
  let value = formatters.get(language);
  if (!value) {
    value = new Intl.DateTimeFormat(language, { month: "short", day: "numeric" });
    formatters.set(language, value);
  }
  return value;
}
function describe(bookmark: Bookmark, language: string) {
  let value = meta.get(bookmark);
  if (value?.language === language) return value;
  let host = "";
  try {
    host = new URL(bookmark.url).hostname.replace(/^www\./, "");
  } catch {}
  const created = new Date(bookmark.createdAt);
  value = {
    language,
    host,
    date: Number.isFinite(created.getTime())
      ? formatter(language).format(created)
      : "",
  };
  meta.set(bookmark, value);
  return value;
}
</script>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useLibrary } from "../stores/library";
import { ipc } from "../ipc/client";
import Icon from "./Icon.vue";
import SplitHandle from "./SplitHandle.vue";
defineProps<{ listWidth: number; listMax: number }>();
defineEmits<{ add: []; sidebar: []; resize: [value: number]; resizeEnd: [] }>();
const store = useLibrary(),
  { t } = useI18n();
const filtering = ref(false),
  pane = ref<HTMLElement>(),
  scroller = ref<HTMLElement>(),
  cursor = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
const highlighted = computed(() => cursor.value ?? store.selected);
const viewTitle = computed(() =>
  store.view.startsWith("collection:")
    ? (store.snapshot?.collections.find(
        (v) => `collection:${v.id}` === store.view,
      )?.name ?? t("collections"))
    : t(store.view),
);
const emptyTitle = computed(() =>
  store.query.trim()
    ? "noResults"
    : store.view === "starred"
      ? "emptyStarred"
      : store.view === "archived"
        ? "emptyArchived"
        : "empty",
);
function choose(id: string, event?: MouseEvent) {
  (event?.currentTarget as HTMLElement | null)?.focus();
  clearTimeout(timer);
  timer = undefined;
  cursor.value = null;
  void store.select(id);
}
function move(event: KeyboardEvent) {
  if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
  const i = store.rows.findIndex((b) => b.id === highlighted.value),
    n = Math.max(
      0,
      Math.min(store.rows.length - 1, i + (event.key === "ArrowUp" ? -1 : 1)),
    ),
    row = store.rows[n];
  if (!row) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement)
    .querySelectorAll<HTMLElement>(".article-row")
    [n]?.focus();
  if (row.id === highlighted.value) return;
  if (!event.repeat) return choose(row.id);
  cursor.value = row.id;
  clearTimeout(timer);
  timer = setTimeout(() => choose(row.id), 120);
}
watch(
  () => [store.view, store.selectedTags],
  () => {
    clearTimeout(timer);
    timer = undefined;
    cursor.value = null;
    if (scroller.value) scroller.value.scrollTop = 0;
  },
);
onBeforeUnmount(() => clearTimeout(timer));
</script>
<template>
  <section ref="pane" class="list-pane" :aria-label="t('library')">
    <header class="toolbar" data-tauri-drag-region>
      <button
        class="icon-button"
        :aria-label="t('toggleSidebar')"
        :title="t('toggleSidebar')"
        @click="$emit('sidebar')"
      >
        <Icon name="sidebar" />
      </button>
      <h2 data-tauri-drag-region>{{ viewTitle }}</h2>
      <span class="spacer" />
      <button
        class="icon-button"
        :aria-label="t('add')"
        :title="t('add')"
        @click="$emit('add')"
      >
        <Icon name="plus" />
      </button>
    </header>
    <div class="search-wrap">
      <Icon name="search" :size="16" /><input
        v-model="store.query"
        type="search"
        maxlength="500"
        :placeholder="t('search')"
        :aria-label="t('search')"
        @keydown.enter="store.search(store.searchMode === 'cloud')"
      />
      <button
        class="filter-toggle icon-button"
        :class="{ active: store.selectedTags.length }"
        :aria-label="t('filterTags')"
        :title="t('filterTags')"
        :aria-expanded="filtering"
        @click="filtering = !filtering"
      >
        <Icon name="tag" :size="15" />
      </button>
      <Transition name="pop"
        ><div
          v-if="filtering"
          class="tag-filter"
          role="group"
          :aria-label="t('filterTags')"
          @keydown.esc="filtering = false"
        >
          <div class="filter-heading">
            <span>{{ t("filterTags") }}</span
            ><button
              class="icon-button"
              :aria-label="t('close')"
              @click="filtering = false"
            >
              <Icon name="close" :size="13" />
            </button>
          </div>
          <p v-if="!store.snapshot?.tags.length" class="muted">
            {{ t("noTags") }}
          </p>
          <label v-for="tag in store.snapshot?.tags ?? []" :key="tag.id"
            ><input
              type="checkbox"
              :checked="store.selectedTags.includes(tag.id)"
              @change="store.toggleTag(tag.id)"
            /><span>{{ tag.name }}</span></label
          >
          <button
            v-if="store.selectedTags.length"
            class="clear-tags"
            @click="store.filterTags([])"
          >
            {{ t("clearFilters") }}
          </button>
        </div></Transition
      >
    </div>
    <div v-if="store.selectedTags.length" class="filter-chips">
      <button
        v-for="id in store.selectedTags"
        :key="id"
        :aria-label="`${t('removeFilter')} ${store.snapshot?.tags.find((v) => v.id === id)?.name ?? ''}`"
        @click="store.toggleTag(id)"
      >
        <Icon name="tag" :size="11" />{{
          store.snapshot?.tags.find((v) => v.id === id)?.name ?? t("tags")
        }}<Icon name="close" :size="11" /></button
      ><button class="clear" @click="store.filterTags([])">
        {{ t("clearFilters") }}
      </button>
    </div>
    <div v-if="store.query.trim()" class="search-caption">
      <span>{{
        t(store.searchMode === "cloud" ? "cloudResults" : "localResults")
      }}</span
      ><button
        v-if="store.searchMode === 'local'"
        class="search-more"
        @click="store.search(true)"
      >
        {{ t("searchMore") }}<Icon name="arrow" :size="13" /></button
      ><button v-else @click="store.search(false)">
        {{ t("searchLocal") }}
      </button>
    </div>
    <div
      v-if="store.searching || store.loading"
      class="progress-line"
      aria-hidden="true"
    />
    <div ref="scroller" class="list-scroll" @keydown="move">
      <div v-if="store.searching" class="empty" role="status">
        <Icon
          :name="store.searchMode === 'cloud' ? 'cloud' : 'search'"
          :size="28"
        />
        <p>
          {{ t(store.searchMode === "cloud" ? "cloudSearching" : "loading") }}
        </p>
      </div>
      <div v-else-if="store.searchError" class="empty">
        <p class="error">{{ t("errors.default") }}</p>
        <button @click="store.search(store.searchMode === 'cloud')">
          {{ t("retry") }}
        </button>
      </div>
      <div v-else-if="!store.rows.length" class="empty">
        <Icon name="book" :size="28" />
        <h2>{{ t(emptyTitle) }}</h2>
        <p v-if="!store.query.trim()">{{ t("emptyBody") }}</p>
        <button
          v-if="store.query.trim() && store.searchMode === 'local'"
          @click="store.search(true)"
        >
          {{ t("searchMore") }}
        </button>
      </div>
      <template v-else>
        <button
          v-for="bookmark in store.rows"
          :key="bookmark.id"
          v-memo="[
            bookmark,
            highlighted === bookmark.id,
            store.preferences.language,
          ]"
          class="article-row"
          :class="{
            selected: highlighted === bookmark.id,
            unread:
              !bookmark.read &&
              bookmark.status === 'success' &&
              bookmark.contentType !== 2,
          }"
          :aria-pressed="highlighted === bookmark.id"
          @click="choose(bookmark.id, $event)"
          @contextmenu.prevent="
            !bookmark.ownerId &&
            ipc.context(store.auth.generation, bookmark.id).catch(store.fail)
          "
        >
          <span class="row-meta"
            ><span class="row-source">{{
              describe(bookmark, store.preferences.language).host ||
              (bookmark.contentType === 2 ? "PDF" : "—")
            }}</span
            ><span class="row-date">{{
              describe(bookmark, store.preferences.language).date
            }}</span></span
          >
          <strong>{{ bookmark.title || bookmark.url }}</strong>
          <p v-if="bookmark.description">{{ bookmark.description }}</p>
          <span class="row-foot"
            ><span
              v-if="bookmark.status !== 'success'"
              class="processing-label"
              >{{
                t(
                  bookmark.status === "failed"
                    ? "articleFailed"
                    : "articleProcessing",
                )
              }}</span
            ><span v-else class="row-status">{{
              bookmark.contentType === 2
                ? "PDF"
                : t(bookmark.read ? "read" : "unread")
            }}</span
            ><span class="spacer" /><Icon
              v-if="bookmark.downloaded"
              name="download"
              :size="12" /><Icon v-if="bookmark.starred" name="star" :size="13"
          /></span>
        </button>
      </template>
    </div>
    <footer class="list-footer">
      {{ t("items", { count: store.rows.length }) }}
    </footer>
  </section>
  <SplitHandle
    :target="pane"
    property="--list-width"
    :model-value="listWidth"
    :min="260"
    :max="listMax"
    :reset="336"
    :label="t('listWidth')"
    @update:model-value="$emit('resize', $event)"
    @finish="$emit('resizeEnd')"
  />
</template>
<style scoped>
.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  margin: 14px 14px 10px;
  color: var(--desktop-faint);
}
.search-wrap > svg {
  position: absolute;
  left: 11px;
  z-index: 1;
  pointer-events: none;
}
.search-wrap > input {
  width: 100%;
  height: 36px;
  padding: 0 40px 0 34px;
  background: var(--desktop-raised);
  border-color: var(--desktop-border);
  font-size: 12.5px;
  border-radius: 9px;
  box-shadow: var(--desktop-shadow-soft);
}
.search-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 0 16px 6px;
  gap: 6px;
  color: var(--desktop-muted);
  font-size: 11px;
}
.search-caption button {
  font-size: 11px;
  padding: 4px;
  color: var(--desktop-accent);
}
.processing-label {
  color: var(--desktop-accent);
}
.empty {
  padding: 32px 20px;
}
.empty h2 {
  font-size: 20px;
}
</style>

<style scoped>
.filter-toggle {
  position: absolute;
  right: 4px;
  top: 4px;
  width: 28px;
  height: 28px;
  min-height: 28px;
  color: var(--desktop-faint);
}
.filter-toggle.active {
  color: var(--desktop-accent);
  background: var(--desktop-selected);
}
.tag-filter {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 10;
  display: grid;
  gap: 4px;
  padding: 12px;
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--desktop-border);
  border-radius: 12px;
  background: var(--desktop-raised);
  box-shadow: var(--desktop-shadow-float);
  color: var(--desktop-text);
}
.filter-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  padding-bottom: 2px;
}
.tag-filter label {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 6px;
  border-radius: 6px;
  font-size: 12px;
}
.tag-filter label:hover {
  background: var(--desktop-hover);
}
.tag-filter input {
  accent-color: var(--desktop-accent);
}
.clear-tags {
  justify-content: flex-start;
  font-size: 11px;
  color: var(--desktop-accent);
}
.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 0 14px 10px;
}
.filter-chips button {
  min-height: 26px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  background: var(--desktop-accent-soft);
  color: var(--desktop-accent);
  border: 1px solid var(--desktop-accent-line);
}
.filter-chips .clear {
  background: transparent;
  border-color: transparent;
  color: var(--desktop-muted);
}
</style>
