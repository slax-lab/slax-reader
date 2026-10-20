<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useLibrary } from "../stores/library";
import { useRss } from "../stores/rss";
import { ipc } from "../ipc/client";
import { frameMessage } from "../reader-protocol";
import Icon from "./Icon.vue";
import Dialog from "./Dialog.vue";
import SplitHandle from "./SplitHandle.vue";
const props = defineProps<{
  active: boolean;
  listWidth: number;
  listMax: number;
}>();
defineEmits<{ sidebar: []; resize: [value: number]; resizeEnd: [] }>();
const library = useLibrary(),
  rss = useRss(),
  { t, te } = useI18n();
const url = ref(""),
  frame = ref<HTMLIFrameElement>(),
  pane = ref<HTMLElement>(),
  scroller = ref<HTMLElement>();
watch(
  () => rss.selectedFeed,
  () => {
    if (scroller.value) scroller.value.scrollTop = 0;
  },
);
watch(
  () => props.active,
  (active) => {
    if (active && !rss.ready && !rss.loading) void rss.load();
  },
  { immediate: true },
);
const errorText = (code: string) =>
  t(te(`errors.${code}`) ? `errors.${code}` : "errors.default");
function message(event: MessageEvent) {
  if (!props.active || !rss.doc) return;
  const value = frameMessage(
    event,
    frame.value?.contentWindow ?? null,
    rss.doc.pageId,
  );
  if (value?.type === "link" && typeof value.url === "string")
    void ipc
      .external(library.auth.generation, rss.doc.handle, value.url)
      .catch(library.fail);
}
onMounted(() => window.addEventListener("message", message));
onBeforeUnmount(() => {
  window.removeEventListener("message", message);
  rss.close();
});
</script>
<template>
  <section ref="pane" class="list-pane" :aria-label="t('rss')">
    <header class="toolbar" data-tauri-drag-region>
      <button
        class="icon-button"
        :aria-label="t('toggleSidebar')"
        @click="$emit('sidebar')"
      >
        <Icon name="sidebar" />
      </button>
      <h2 data-tauri-drag-region>{{ t("rss") }}</h2>
      <span class="spacer" /><button
        class="icon-button"
        :disabled="rss.loading || rss.busy"
        :aria-label="t('refresh')"
        :title="t('refresh')"
        @click="rss.refresh"
      >
        <Icon name="refresh" :size="16" /></button
      ><button
        class="icon-button"
        :disabled="!rss.enabled"
        :aria-label="t('follow')"
        :title="t('follow')"
        @click="rss.adding = true"
      >
        <Icon name="plus" />
      </button>
    </header>
    <div class="feed-heading">
      <strong>{{
        rss.feeds.find((f) => f.id === rss.selectedFeed)?.remark ||
        rss.feeds.find((f) => f.id === rss.selectedFeed)?.title ||
        t("rssBack")
      }}</strong>
      <span>{{ t("items", { count: rss.entries.length }) }}</span>
    </div>
    <div v-if="rss.loading" class="progress-line" aria-hidden="true" />
    <div ref="scroller" class="list-scroll">
      <div v-if="rss.error" class="empty">
        <p class="error">{{ errorText(rss.error) }}</p>
        <button @click="rss.load">{{ t("retry") }}</button>
      </div>
      <div
        v-else-if="rss.loading && !rss.entries.length"
        class="empty"
        role="status"
      >
        {{ t("loading") }}
      </div>
      <div v-else-if="rss.ready && !rss.enabled" class="empty">
        <Icon name="rss" :size="30" />
        <h2>{{ t("rss") }}</h2>
        <p>{{ t("rssDescription") }}</p>
        <button class="primary" :disabled="rss.busy" @click="rss.enable">
          {{ t("rssEnable") }}
        </button>
      </div>
      <div v-else-if="!rss.entries.length" class="empty">
        <Icon name="rss" :size="30" />
        <h2>{{ t(rss.feeds.length ? "noEntries" : "rssEmpty") }}</h2>
        <button v-if="rss.enabled" @click="rss.adding = true">
          {{ t("follow") }}
        </button>
      </div>
      <button
        v-for="value in rss.entries"
        :key="value.id"
        v-memo="[
          value,
          rss.entry?.id === value.id,
          value.bookmark_user_uuid,
          value.source_title,
          value.title,
          value.summary,
        ]"
        class="article-row"
        :class="{ selected: rss.entry?.id === value.id }"
        :aria-pressed="rss.entry?.id === value.id"
        @click="rss.choose(value)"
      >
        <span class="row-meta"
          ><span>{{ value.source_title }}</span
          ><Icon
            v-if="value.bookmark_user_uuid"
            name="check"
            :size="12" /></span
        ><strong>{{ value.title }}</strong>
        <p>{{ value.summary }}</p>
      </button>
      <button
        v-if="rss.hasMore"
        class="load-more"
        :disabled="rss.busy || rss.loading"
        @click="rss.more"
      >
        {{ t(rss.busy ? "loading" : "loadMore") }}
      </button>
    </div>
    <footer class="list-footer">
      {{ t("items", { count: rss.entries.length }) }}
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
  <section class="rss-reader">
    <header class="toolbar" data-tauri-drag-region>
      <span class="reader-label" data-tauri-drag-region>{{
        t("rssReading")
      }}</span
      ><span class="spacer" /><template v-if="rss.entry"
        ><button
          v-if="rss.doc"
          class="icon-button"
          :title="t('original')"
          :aria-label="t('original')"
          @click="
            ipc
              .external(
                library.auth.generation,
                rss.doc.handle,
                rss.doc.sourceUrl,
              )
              .catch(library.fail)
          "
        >
          <Icon name="arrow" :size="16" /></button
        ><button
          :disabled="rss.busy || !!rss.entry.bookmark_user_uuid"
          :class="{ primary: !rss.entry.bookmark_user_uuid }"
          @click="rss.save"
        >
          <Icon
            :name="rss.entry.bookmark_user_uuid ? 'check' : 'plus'"
            :size="14"
          />{{ t(rss.entry.bookmark_user_uuid ? "saved" : "save") }}
        </button></template
      >
    </header>
    <div v-if="rss.readerLoading" class="empty" role="status">
      {{ t("loading") }}
    </div>
    <div v-else-if="rss.readerError" class="empty">
      <p class="error">{{ errorText(rss.readerError) }}</p>
      <button v-if="rss.entry" @click="rss.choose(rss.entry)">
        {{ t("retry") }}
      </button>
    </div>
    <iframe
      v-else-if="rss.doc"
      ref="frame"
      :key="rss.doc.pageId"
      :src="rss.doc.url"
      sandbox="allow-scripts"
      :title="rss.doc.title"
      referrerpolicy="no-referrer"
    />
    <div v-else class="empty">
      <Icon name="rss" :size="36" />
      <h2>{{ t("rssDescription") }}</h2>
      <p>{{ t("rssSelect") }}</p>
    </div>
  </section>
  <Dialog v-if="rss.adding" :title="t('follow')" @close="rss.adding = false"
    ><form @submit.prevent="rss.follow(url)">
      <input
        v-model="url"
        type="url"
        required
        :placeholder="t('rssUrl')"
        :aria-label="t('rssUrl')"
      />
      <div class="actions">
        <button type="button" @click="rss.adding = false">
          {{ t("cancel") }}</button
        ><button class="primary" :disabled="rss.busy || !url">
          {{ t(rss.busy ? "loading" : "follow") }}
        </button>
      </div>
    </form></Dialog
  >
</template>
<style scoped>
.feed-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 12px;
}
.feed-heading strong {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.15px;
  overflow-wrap: anywhere;
}
.feed-heading span {
  flex-shrink: 0;
  color: var(--desktop-faint);
  font-size: 10.5px;
  padding-top: 3px;
}
.rss-reader {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--desktop-reader);
  color: var(--desktop-reader-text);
}
.rss-reader .toolbar {
  background: var(--desktop-surface);
  color: var(--desktop-text);
}
.reader-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--desktop-faint);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.reader-label::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--desktop-accent);
}
.rss-reader iframe {
  border: 0;
  width: 100%;
  flex: 1;
  min-height: 0;
  background: var(--desktop-reader);
}
.rss-reader .empty {
  color: var(--desktop-reader-muted);
}
.rss-reader .empty h2 {
  color: var(--desktop-reader-text);
  font-size: 22px;
}
.load-more {
  width: 100%;
  margin-top: 16px;
  border: 1px dashed var(--desktop-border-strong);
  border-radius: 8px;
  color: var(--desktop-accent);
}
.load-more:hover:not(:disabled) {
  border-color: var(--desktop-accent-line);
  background: var(--desktop-accent-soft);
}
form {
  display: grid;
  gap: 16px;
}
form input {
  width: 100%;
}
</style>
