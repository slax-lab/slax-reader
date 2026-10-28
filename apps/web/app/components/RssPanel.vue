<template>
  <div class="rss-panel">
    <div class="rss-heading">
      <div class="title-line">
        <h1>{{ $t('rss.title') }}</h1>
        <span class="labs-badge">{{ $t('rss.labs') }}</span>
      </div>
      <button v-if="rss.enabled.value" class="rss-button primary" @click="showAdd"><RssIcon name="plus" />{{ $t('rss.add') }}</button>
    </div>
    <div v-if="rss.error.value && !previewEntry && !adding && !removing" class="rss-notice" role="alert">
      <span>{{ errorText }}</span
      ><button class="text-button" @click="rss.initialize()">{{ $t('rss.retry') }}</button>
    </div>
    <div v-if="rss.enabled.value" class="list-toolbar">
      <div v-if="rss.subscriptions.value.length" class="source-switcher" role="group" :aria-label="$t('rss.sources')">
        <button class="source-tile" :class="{ active: !rss.selected.value }" type="button" :aria-pressed="!rss.selected.value" @click="rss.select('')">
          <span class="source-avatar all-feeds"><RssIcon name="rss" /></span>
          <span class="source-label">{{ $t('rss.all') }}</span>
        </button>
        <button
          v-for="sub in rss.subscriptions.value"
          :key="sub.id"
          class="source-tile"
          :class="{ active: rss.selected.value === sub.id }"
          type="button"
          :aria-pressed="rss.selected.value === sub.id"
          :title="rssSubscriptionName(sub)"
          @click="rss.select(sub.id)"
        >
          <span class="source-avatar">
            <img v-if="sub.icon_url && !failedIcons.has(sub.icon_url)" :src="sub.icon_url" alt="" loading="lazy" referrerpolicy="no-referrer" @error="iconFailed(sub)" />
            <span v-else class="source-fallback" :class="{ 'source-word': rssSourceText(rssSubscriptionName(sub)).length > 1 }">{{ rssSourceText(rssSubscriptionName(sub)) }}</span>
          </span>
          <span class="source-label">{{ rssSubscriptionName(sub) }}</span>
        </button>
      </div>
      <div class="source-actions">
        <button
          class="icon-button"
          :disabled="rss.pending.value || rss.loading.value || current?.refreshing || coolingDown"
          :title="refreshTitle"
          :aria-label="refreshTitle"
          @click="rss.refresh()"
        >
          <RssIcon name="refresh" :class="{ spinning: current?.refreshing || rss.loading.value }" />
        </button>
        <button v-if="current" class="icon-button" :title="$t('rss.edit')" :aria-label="$t('rss.edit')" @click="showEdit(current)"><RssIcon name="edit" /></button>
        <button v-if="current" class="icon-button" :title="$t('rss.remove')" :aria-label="$t('rss.remove')" @click="removing = current"><RssIcon name="trash" /></button>
        <ListLayoutSwitcher v-if="rss.entries.value.length" v-model="listMode" last-updated-text="" />
      </div>
    </div>
    <p v-if="current?.error" class="rss-notice" role="status">{{ $t('rss.source_error') }}</p>

    <section v-if="rss.initializing.value && !rss.enabled.value" class="empty-state" role="status">
      <RssIcon name="refresh" class="spinning" />
      <p>{{ $t('rss.loading') }}</p>
    </section>
    <section v-else-if="!rss.enabled.value" class="empty-state">
      <div class="empty-icon"><RssIcon name="rss" /></div>
      <h2>{{ $t('rss.title') }}</h2>
      <p>{{ $t('rss.enable_hint') }}</p>
      <NuxtLink class="rss-button primary" :to="localePath('/user') + '#features'">{{ $t('rss.settings') }}</NuxtLink>
    </section>
    <section v-else :aria-label="$t('rss.all')" :aria-busy="rss.loading.value">
      <div v-if="(rss.loading.value || rss.initializing.value) && !rss.entries.value.length" class="skeletons" role="status">
        <span class="sr-only">{{ $t('rss.loading') }}</span>
        <div v-for="n in 4" :key="n" class="skeleton-row">
          <div><i /><i /><i /></div>
          <i />
        </div>
      </div>
      <section v-else-if="!rss.entries.value.length" class="empty-state">
        <div class="empty-icon"><RssIcon name="rss" /></div>
        <h2>{{ $t(rss.subscriptions.value.length ? 'rss.no_articles' : 'rss.no_subscriptions') }}</h2>
        <p>{{ $t(rss.subscriptions.value.length ? 'rss.empty_articles_hint' : 'rss.empty_hint') }}</p>
        <button v-if="!rss.subscriptions.value.length" class="rss-button primary" @click="showAdd"><RssIcon name="plus" />{{ $t('rss.add') }}</button>
      </section>
      <p v-else-if="!visibleEntries.length" class="empty-state">{{ $t('rss.no_matches') }}</p>
      <template v-for="entry in visibleEntries" :key="entry.id">
        <article :class="{ 'text-row': listMode === 'text' }" class="rss-row">
          <button class="article-main" @click="open(entry)">
            <div class="article-copy">
              <div class="article-meta">
                <span>{{ entry.source_title }}</span
                ><span>·</span><time :datetime="entry.published_at || entry.first_seen_at">{{ date(entry.published_at || entry.first_seen_at) }}</time>
              </div>
              <h2>{{ entry.title }}</h2>
              <p v-if="listMode === 'card' && entry.summary">{{ entry.summary }}</p>
            </div>
            <img
              v-if="listMode === 'card' && entry.image_url && !failedImages.has(entry.image_url)"
              class="article-image"
              :src="entry.image_url"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="failedImages.add(entry.image_url!)"
            />
          </button>
          <div class="article-footer">
            <span>{{ entry.author }}</span
            ><NuxtLink v-if="entry.bookmark_user_uuid" class="save-action saved" :to="localePath('/b/' + entry.bookmark_user_uuid)"
              ><RssIcon name="check" />{{ $t('rss.saved') }}</NuxtLink
            ><button v-else class="save-action" :disabled="rss.pending.value || !entry.article_url" :title="!entry.article_url ? $t('rss.no_url') : ''" @click="rss.save(entry)">
              <RssIcon name="bookmark" />{{ $t('rss.save') }}
            </button>
          </div>
        </article>
      </template>
      <div v-if="rss.hasMore.value" class="load-more">
        <button class="rss-button" :disabled="rss.loading.value || historyCoolingDown" @click="rss.reload(true)">{{ $t(rss.loading.value ? 'rss.loading' : 'rss.more') }}</button>
        <span v-if="rss.historyStatus.value === 'retry'" class="update-caption" role="status">{{ $t('rss.history_retry') }}</span>
        <span v-else-if="rss.historyStatus.value === 'loading'" class="update-caption" role="status">{{ $t('rss.history_loading') }}</span>
      </div>
      <p v-else-if="rss.entries.value.length && !rss.loading.value" class="list-end">{{ $t('rss.history_end', { count: rss.entries.value.length }) }}</p>
      <p v-if="search" class="update-caption">{{ $t('rss.search_hint') }}</p>
    </section>
    <dialog ref="preview" class="rss-dialog reader-dialog" aria-labelledby="rss-preview-title" @close="closePreview" @click="closeBackdrop($event, preview)">
      <template v-if="previewEntry">
        <header class="reader-toolbar">
          <span>{{ previewEntry.source_title }}</span>
          <button class="icon-button" :aria-label="$t('rss.close')" @click="preview?.close()"><RssIcon name="close" /></button>
        </header>
        <div class="reader-scroll">
          <div class="reader-meta">
            {{ date(previewEntry.published_at || previewEntry.first_seen_at) }}<span v-if="previewEntry.author"> · {{ previewEntry.author }}</span>
          </div>
          <h2 id="rss-preview-title">{{ previewEntry.title }}</h2>
          <p class="feed-caption">{{ $t('rss.feed_content') }}</p>
          <p v-if="rss.detailLoading.value" class="preview-loading" role="status"><RssIcon name="refresh" class="spinning" />{{ $t('rss.loading') }}</p>
          <p v-else-if="rss.error.value && !rss.detail.value" class="rss-notice" role="alert">
            {{ errorText }} <button class="text-button" @click="rss.open(previewEntry)">{{ $t('rss.retry') }}</button>
          </p>
          <div v-else class="rss-body" v-html="safeHtml" @error.capture="imageFailed" />
          <p v-if="rss.detail.value?.content_truncated" class="feed-caption">{{ $t('rss.truncated') }}</p>
          <p v-if="rss.error.value && rss.detail.value" class="rss-notice" role="alert">{{ errorText }}</p>
        </div>
        <footer class="reader-footer">
          <a v-if="previewEntry.article_url" class="text-button" :href="previewEntry.article_url" target="_blank" rel="noopener noreferrer"
            >{{ $t('rss.original') }}<RssIcon name="external" /></a
          ><span v-else class="update-caption">{{ $t('rss.no_url') }}</span
          ><NuxtLink v-if="previewBookmark" class="rss-button primary" :to="localePath('/b/' + previewBookmark)"><RssIcon name="check" />{{ $t('rss.saved') }}</NuxtLink
          ><button v-else class="rss-button primary" :disabled="rss.pending.value || !previewEntry.article_url" @click="rss.save(rss.detail.value || previewEntry)">
            <RssIcon name="bookmark" />{{ $t('rss.save') }}
          </button>
        </footer>
      </template>
    </dialog>

    <dialog ref="addDialog" class="rss-dialog compact-dialog" aria-labelledby="rss-add-title" @close="adding = false" @click="closeBackdrop($event, addDialog)">
      <form @submit.prevent="add">
        <header class="dialog-header">
          <h2 id="rss-add-title">{{ $t(editing ? 'rss.edit' : 'rss.add') }}</h2>
          <button type="button" class="icon-button" :aria-label="$t('rss.close')" @click="addDialog?.close()"><RssIcon name="close" /></button>
        </header>
        <p class="dialog-description">{{ $t(editing ? 'rss.edit_hint' : 'rss.add_hint') }}</p>
        <label class="input-label" for="rss-feed-url">{{ $t('rss.url') }}</label
        ><input
          id="rss-feed-url"
          v-model="url"
          :readonly="!!editing"
          type="url"
          required
          maxlength="2048"
          placeholder="https://example.com/feed.xml"
          autocomplete="off"
          autofocus
        />
        <label class="input-label remark-label" for="rss-remark">{{ $t('rss.remark') }}</label>
        <input id="rss-remark" v-model="remark" type="text" maxlength="120" :placeholder="editing?.title || $t('rss.remark_placeholder')" />
        <p class="update-caption">{{ $t('rss.remark_hint') }}</p>
        <p v-if="!editing" class="update-caption">{{ $t('rss.feed_limit', { count: rss.subscriptions.value.length }) }}</p>
        <p v-if="rss.error.value" class="rss-notice" role="alert">{{ errorText }}</p>
        <footer class="dialog-actions">
          <button type="button" class="rss-button" @click="addDialog?.close()">{{ $t('rss.cancel') }}</button
          ><button class="rss-button primary" type="submit" :disabled="rss.pending.value">
            <RssIcon v-if="rss.pending.value" name="refresh" class="spinning" />{{ $t(rss.pending.value ? 'rss.saving' : editing ? 'rss.save_changes' : 'rss.add') }}
          </button>
        </footer>
      </form>
    </dialog>
    <dialog ref="removeDialog" class="rss-dialog compact-dialog" aria-labelledby="rss-remove-title" @close="removing = null" @click="closeBackdrop($event, removeDialog)">
      <header class="dialog-header">
        <h2 id="rss-remove-title">{{ $t('rss.remove') }}</h2>
        <button class="icon-button" :aria-label="$t('rss.close')" @click="removeDialog?.close()"><RssIcon name="close" /></button>
      </header>
      <p class="remove-title">{{ removing ? rssSubscriptionName(removing) : '' }}</p>
      <p class="dialog-description">{{ $t('rss.confirm_remove') }}</p>
      <p v-if="rss.error.value" class="rss-notice" role="alert">{{ errorText }}</p>
      <footer class="dialog-actions">
        <button class="rss-button" @click="removeDialog?.close()">{{ $t('rss.cancel') }}</button
        ><button class="rss-button danger" :disabled="rss.pending.value" @click="remove">{{ $t('rss.remove') }}</button>
      </footer>
    </dialog>
  </div>
</template>
<script setup lang="ts">
import ListLayoutSwitcher from '~/components/BookmarkList/ListLayoutSwitcher.vue'
import RssIcon from '~/components/RssIcon.vue'

import { sanitizeRssPreview } from '~/utils/rssPreview'

import type { RssEntry, RssSubscription } from '@slax-reader/contracts'
import { rssSourceText, rssSubscriptionName, useRss } from '~/composables/useRss'
import { useUserStore } from '~/stores/user'

const props = defineProps<{ active: boolean; search: string }>()
const listMode = defineModel<'card' | 'text'>('listMode', { required: true })
const search = computed(() => props.search)
const rss = useRss()
const localePath = useLocalePath()
const { t, locale, te } = useI18n()
const user = useUserStore()
const remark = ref(''),
  editing = ref<RssSubscription | null>(null)
const url = ref(''),
  adding = ref(false)
const preview = ref<HTMLDialogElement>(),
  addDialog = ref<HTMLDialogElement>(),
  removeDialog = ref<HTMLDialogElement>()
const previewEntry = ref<RssEntry | null>(null),
  removing = ref<RssSubscription | null>(null),
  now = ref(Date.now())
const failedImages = reactive(new Set<string>())
const failedIcons = reactive(new Set<string>())
const current = computed(() => rss.subscriptions.value.find(row => row.id === rss.selected.value))
const coolingDown = computed(() => !!current.value && Date.parse(current.value.next_allowed_at) > now.value)
const historyCoolingDown = computed(() => !!rss.retryAt.value && Date.parse(rss.retryAt.value) > now.value)
const refreshTitle = computed(() =>
  current.value?.refreshing ? t('rss.refreshing') : coolingDown.value ? t('rss.next_refresh', { time: date(current.value!.next_allowed_at) }) : t('rss.refresh')
)
const previewBookmark = computed(() => rss.detail.value?.bookmark_user_uuid || rss.entries.value.find(row => row.id === previewEntry.value?.id)?.bookmark_user_uuid)
const visibleEntries = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  return term ? rss.entries.value.filter(row => [row.title, row.summary, row.source_title].some(text => text.toLocaleLowerCase().includes(term))) : rss.entries.value
})
const iconFailed = (sub: RssSubscription) => {
  if (sub.icon_url) failedIcons.add(sub.icon_url)
}
const errorText = computed(() => (te('rss.errors.' + rss.error.value) ? t('rss.errors.' + rss.error.value) : t('rss.source_error')))
const date = (value: string | null) => (value ? new Date(value).toLocaleString(locale.value, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const safeHtml = computed(() => (import.meta.client && rss.detail.value ? sanitizeRssPreview(rss.detail.value.content_html, import.meta.dev) : ''))
const imageFailed = (event: Event) => {
  if (event.target instanceof HTMLImageElement) {
    event.target.removeAttribute('src')
    event.target.hidden = true
  }
}
const closeBackdrop = (event: MouseEvent, dialog?: HTMLDialogElement) => {
  if (event.target === dialog) dialog?.close()
}
const showAdd = () => {
  rss.error.value = ''
  editing.value = null
  url.value = ''
  remark.value = ''
  adding.value = true
  addDialog.value?.showModal()
}
const showEdit = (row: RssSubscription) => {
  rss.error.value = ''
  editing.value = row
  url.value = row.feed_url
  remark.value = row.remark || ''
  adding.value = true
  addDialog.value?.showModal()
}
const add = async () => {
  if (editing.value) await rss.update(editing.value.id, remark.value)
  else await rss.add(url.value.trim(), remark.value)
  if (!rss.error.value) {
    url.value = ''
    addDialog.value?.close()
  }
}
const remove = async () => {
  if (removing.value) await rss.remove(removing.value.id)
  if (!rss.error.value) removeDialog.value?.close()
}
const open = (entry: RssEntry) => {
  previewEntry.value = entry
  preview.value?.showModal()
  void rss.open(entry)
}
const closePreview = () => {
  if (preview.value?.open) preview.value.close()
  rss.closePreview()
  previewEntry.value = null
}
watch(removing, async value => {
  if (value) {
    rss.error.value = ''
    await nextTick()
    removeDialog.value?.showModal()
  }
})
watch(rss.enabled, value => {
  if (!value) {
    closePreview()
    addDialog.value?.close()
    removeDialog.value?.close()
  }
})
watch(
  () => user.userInfo?.userId,
  () => {
    closePreview()
    addDialog.value?.close()
    removeDialog.value?.close()
    previewEntry.value = null
    failedImages.clear()
    failedIcons.clear()
  }
)
const pageActive = ref(true)
const closeDialogs = () => {
  closePreview()
  addDialog.value?.close()
  removeDialog.value?.close()
}
let timer: ReturnType<typeof setInterval> | undefined,
  lastPoll = 0
const load = () => {
  if (!props.active || !pageActive.value || rss.initializing.value || rss.loading.value || rss.pending.value || previewEntry.value) return
  lastPoll = Date.now()
  void rss.initialize()
}
watch(
  () => props.active,
  active => {
    if (active) load()
    else closeDialogs()
  }
)
onActivated(() => {
  pageActive.value = true
  load()
})
onDeactivated(() => {
  pageActive.value = false
  closeDialogs()
})
onMounted(() => {
  load()
  timer = setInterval(() => {
    now.value = Date.now()
    if (document.visibilityState !== 'visible') return
    if (rss.subscriptions.value.some(row => row.refreshing) || now.value - lastPoll >= 60_000) load()
  }, 5000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>
<style scoped>
.rss-panel {
  color: var(--slax-text);
}
.remark-label {
  margin-top: 20px;
}
.text-row {
  padding-block: 14px;
}
.text-row h2 {
  font-size: 17px;
}
.text-row .article-footer {
  margin-top: 4px;
}
.rss-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin: 0 0 10px;
}
.title-line {
  display: flex;
  align-items: center;
  gap: 12px;
}
h1 {
  margin: 0;
  font: 500 30px/1.3 var(--slax-font-serif);
  letter-spacing: -0.025em;
}
.labs-badge {
  border: 1px solid var(--slax-border);
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11px;
  color: var(--slax-text-muted);
  white-space: nowrap;
}
.source-switcher {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 6px;
  overflow-x: auto;
  padding: 4px 2px;
  scrollbar-width: thin;
}
.source-tile {
  width: 70px;
  min-width: 70px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--slax-text-muted);
  cursor: pointer;
  font: inherit;
}
.source-avatar {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 50%;
  background: var(--slax-surface);
  box-shadow: inset 0 0 0 1px var(--slax-border);
  transition:
    border-color 0.15s,
    transform 0.15s;
}
.source-avatar img {
  width: 30px;
  height: 30px;
  object-fit: contain;
  border-radius: 7px;
}
.source-avatar.all-feeds {
  color: var(--slax-accent);
  background: var(--slax-accent-bg);
}
.source-fallback {
  font: 500 21px/1 var(--slax-font-serif);
  color: var(--slax-accent);
}
.source-word {
  max-width: 34px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.source-label {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  font-size: 11px;
}
.source-tile:hover .source-avatar {
  transform: translateY(-2px);
  border-color: var(--slax-border);
}
.source-tile.active {
  color: var(--slax-text);
  font-weight: 600;
}
.source-tile.active .source-avatar {
  border-color: var(--slax-accent);
}
.rss-button,
.icon-button,
.text-button,
.save-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 0;
  cursor: pointer;
  font: inherit;
  text-decoration: none;
  transition:
    background 0.15s,
    color 0.15s;
}
.rss-button {
  padding: 10px 16px;
  min-height: 40px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  font-size: 13px;
  font-weight: 500;
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  white-space: nowrap;
}
.rss-button svg,
.save-action svg,
.text-button svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.rss-button:hover {
  background: var(--slax-accent-bg);
}
.rss-button.primary {
  background: var(--slax-accent);
  border-color: var(--slax-accent);
  color: var(--slax-btn-text);
}
.rss-button.primary:hover {
  filter: brightness(0.94);
}
.rss-button.danger {
  color: var(--slax-accent);
  background: var(--slax-accent-bg);
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button:focus-visible,
a:focus-visible,
input:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--slax-border);
}
.update-caption {
  font-size: 11px;
  color: var(--slax-text-light);
  line-height: 1.7;
}
.update-caption {
  margin: 10px 0;
}
.source-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
  gap: 4px;
}
.source-actions :deep(.page-toolbar) {
  margin: 0;
  padding: 0 0 0 8px;
  border-left: 1px solid var(--slax-border);
}
.icon-button {
  background: transparent;
  color: var(--slax-text-muted);
  width: 34px;
  height: 34px;
  padding: 7px;
  border-radius: 8px;
  flex-shrink: 0;
}
.icon-button:hover {
  color: var(--slax-text);
  background: var(--slax-accent-bg);
}
.rss-row {
  border-bottom: 1px solid var(--slax-border);
  padding: 24px 0 18px;
}
.article-main {
  display: flex;
  gap: 24px;
  align-items: center;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  color: inherit;
  width: 100%;
  cursor: pointer;
}
.article-copy {
  flex: 1;
  min-width: 0;
}
.article-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--slax-text-light);
  line-height: 1.6;
}
.article-meta > span:first-child {
  color: var(--slax-text-muted);
  max-width: 240px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rss-row h2 {
  font: 500 20px/1.55 var(--slax-font-serif);
  letter-spacing: -0.015em;
  margin: 7px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.article-main:hover h2 {
  color: var(--slax-accent);
}
.rss-row p {
  margin: 0;
  font-size: 13px;
  color: var(--slax-text-muted);
  line-height: 1.75;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.article-image {
  width: 112px;
  height: 84px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: var(--slax-radius-sm);
}
.article-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  min-height: 28px;
}
.article-footer > span {
  color: var(--slax-text-light);
  font-size: 11px;
}
.save-action {
  padding: 4px 0 4px 8px;
  font-size: 11px;
  color: var(--slax-text-muted);
  background: transparent;
}
.save-action:hover,
.save-action.saved {
  color: var(--slax-accent);
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  min-height: 360px;
  padding: 48px 24px;
  gap: 14px;
}
.empty-icon {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border: 1px solid var(--slax-border);
  background: var(--slax-surface);
  border-radius: 20px;
  color: var(--slax-accent);
  margin-bottom: 5px;
}
.empty-icon svg {
  width: 27px;
  height: 27px;
}
.empty-state h2 {
  font: 500 22px/1.5 var(--slax-font-serif);
  margin: 0;
}
.empty-state p {
  max-width: 350px;
  color: var(--slax-text-muted);
  font-size: 13px;
  line-height: 1.8;
  margin: 0 0 8px;
}
.rss-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--slax-accent-bg);
  border-radius: 8px;
  color: var(--slax-text);
  font-size: 12px;
  line-height: 1.7;
  padding: 12px 16px;
  margin: 12px 0;
}
.text-button {
  color: var(--slax-accent);
  background: transparent;
  font-size: 12px;
  padding: 4px 0;
}
.load-more {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 0;
}
.list-end {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: var(--slax-text-light);
}
.rss-dialog {
  padding: 0;
  margin: auto;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  box-shadow: var(--slax-shadow-lg);
  width: calc(100% - 32px);
  max-height: calc(100dvh - 48px);
}
.rss-dialog::backdrop {
  background: rgba(20, 18, 16, 0.4);
  backdrop-filter: blur(4px);
}
.compact-dialog {
  max-width: 460px;
  padding: 24px;
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dialog-header h2 {
  font: 500 22px/1.4 var(--slax-font-serif);
  margin: 0;
}
.dialog-description {
  font-size: 13px;
  line-height: 1.8;
  color: var(--slax-text-muted);
  margin: 16px 0 24px;
}
.input-label {
  display: block;
  font-size: 12px;
  margin: 0 0 8px;
}
input {
  box-sizing: border-box;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--slax-border);
  border-radius: 8px;
  font: inherit;
  font-size: 14px;
  color: var(--slax-text);
  background: var(--slax-bg);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 28px;
}
.remove-title {
  font-size: 15px;
  font-weight: 500;
  margin: 24px 0 0;
  overflow-wrap: anywhere;
}
.reader-dialog {
  max-width: 820px;
}
.reader-dialog[open] {
  display: flex;
  flex-direction: column;
}
.reader-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  border-bottom: 1px solid var(--slax-border);
  font-size: 12px;
  color: var(--slax-text-muted);
}
.reader-scroll {
  overflow-y: auto;
  padding: 36px 56px 48px;
  min-height: 200px;
  overscroll-behavior: contain;
}
.reader-meta {
  font-size: 12px;
  color: var(--slax-text-light);
}
.reader-scroll h2 {
  font: 500 30px/1.5 var(--slax-font-serif);
  margin: 14px 0 18px;
  overflow-wrap: anywhere;
}
.feed-caption {
  color: var(--slax-text-light);
  font-size: 12px;
  line-height: 1.7;
  margin-bottom: 28px;
}
.reader-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px;
  border-top: 1px solid var(--slax-border);
}
.rss-body {
  font-size: 16px;
  line-height: 1.95;
  overflow-wrap: anywhere;
}
.rss-body :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 24px auto;
}
.rss-body :deep(img[hidden]) {
  display: none;
}
.rss-body :deep(pre) {
  overflow-x: auto;
  padding: 16px;
  font-size: 13px;
  border-radius: 8px;
  background: var(--slax-bg);
}
.rss-body :deep(p) {
  margin: 20px 0;
}
.rss-body :deep(h1),
.rss-body :deep(h2),
.rss-body :deep(h3) {
  font-family: var(--slax-font-serif);
  margin: 28px 0 16px;
}
.rss-body :deep(ul),
.rss-body :deep(ol) {
  padding-left: 24px;
  list-style: revert;
}
.rss-body :deep(blockquote) {
  border-left: 3px solid var(--slax-border);
  padding-left: 20px;
  margin: 24px 0;
  color: var(--slax-text-muted);
}
.rss-body :deep(a) {
  color: var(--slax-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.preview-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 36px 0;
  color: var(--slax-text-muted);
  font-size: 13px;
}
.skeleton-row {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 28px 0;
  border-bottom: 1px solid var(--slax-border);
}
.skeleton-row > div {
  flex: 1;
}
.skeleton-row i {
  display: block;
  height: 12px;
  margin: 10px 0;
  width: 90%;
  border-radius: 4px;
  background: var(--slax-border);
  opacity: 0.5;
}
.skeleton-row > div i:first-child {
  width: 28%;
  height: 8px;
}
.skeleton-row > div i:nth-child(2) {
  width: 75%;
  height: 20px;
}
.skeleton-row > i {
  width: 112px;
  height: 84px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.spinning {
  animation: rss-spin 1.5s linear infinite;
}
@keyframes rss-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 768px) {
  .rss-heading {
    align-items: flex-start;
    gap: 12px;
    margin: 0 0 10px;
  }
  h1 {
    font-size: 24px;
  }
  .title-line {
    gap: 8px;
    flex-wrap: wrap;
  }
  .rss-heading > .rss-button {
    padding: 8px 10px;
  }
  .rss-heading > .rss-button svg {
    display: none;
  }
  .source-switcher {
    gap: 4px;
  }
  .source-tile {
    width: 70px;
    min-width: 70px;
  }
  .list-toolbar {
    gap: 8px;
  }
  .article-main {
    gap: 14px;
  }
  .article-image {
    width: 80px;
    height: 76px;
  }
  .rss-row h2 {
    font-size: 18px;
  }
  .article-meta {
    font-size: 10px;
  }
  .reader-scroll {
    padding: 24px;
  }
  .reader-scroll h2 {
    font-size: 25px;
  }
  .reader-footer {
    padding: 14px 16px;
    gap: 10px;
  }
  .reader-footer .rss-button {
    padding: 9px 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
