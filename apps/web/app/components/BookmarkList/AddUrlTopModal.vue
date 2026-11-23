<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-backdrop" @click.self="closeModal">
        <div class="modal-dialog" :class="{ 'pdf-upload-enabled': pdfUploadEnabled }" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t('add_content.title') }}</h3>
            <button class="modal-close" @click="closeModal" type="button" :aria-label="$t('common.operate.close')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div v-if="tabs.length > 1" class="add-tabs" role="tablist" :aria-label="$t('add_content.title')">
            <button v-for="tab in tabs" :id="`add-tab-${tab}`" :key="tab" type="button" role="tab" :aria-selected="mode === tab" :aria-controls="`add-panel-${tab}`" :tabindex="mode === tab ? 0 : -1" :disabled="searchModalLoading" :class="{ selected: mode === tab }" @click="mode = tab" @keydown="tabKeydown($event, tab)">{{ $t(`add_content.${tab}`) }}</button>
          </div>
          <section :id="`add-panel-${mode}`" role="tabpanel" :aria-labelledby="tabs.length > 1 ? `add-tab-${mode}` : undefined">
          <p class="modal-desc">{{ $t(mode === 'feed' ? 'rss.add_hint' : mode === 'file' ? 'pdf.upload_limit' : 'component.add_url_top_modal.add_url.placeholder') }}</p>
          <div v-if="mode !== 'file'" class="modal-input-wrap" :class="{ error: mode === 'url' && showError }">
            <svg class="modal-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            <input
              v-autofocus
              v-ime-guard
              type="url"
              class="modal-input"
              v-model="addUrlText"
              :placeholder="$t(mode === 'feed' ? 'add_content.feed_placeholder' : 'component.add_url_top_modal.add_url.placeholder')"
              autocomplete="off"
              @keydown.enter="topModalClick"
              @keydown.esc="closeModal"
              @input="resetInputState"
            />
          </div>
          <p class="modal-error" v-if="mode === 'url' && showError">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {{ $t('component.add_url_top_modal.add_url.invalid_url') }}
          </p>
          <div v-if="showFeedHint" class="feed-hint" role="status">
            <p>{{ $t('add_content.feed_hint') }}</p>
            <div class="hint-actions">
              <button type="button" @click="mode = 'feed'">{{ $t('add_content.switch_feed') }}</button>
              <button type="button" class="muted" @click="dismissedFeedUrl = trimmedUrl">{{ $t('add_content.keep_url') }}</button>
            </div>
          </div>
          <template v-if="mode === 'feed'">
            <label for="add-feed-name" class="feed-name-label">{{ $t('rss.remark') }}</label>
            <div class="modal-input-wrap"><input id="add-feed-name" v-model="feedName" class="modal-input" maxlength="120" :placeholder="$t('rss.remark_placeholder')" :disabled="searchModalLoading" @keydown.enter="topModalClick" /></div>
            <p v-if="feedError" class="modal-error" role="alert">{{ feedError }}</p>
          </template>
          <template v-if="mode === 'file' && pdfUploadEnabled">
            <div class="pdf-upload">
              <input ref="pdfInput" type="file" accept="application/pdf,.pdf" class="sr-only" :disabled="searchModalLoading" @change="selectPdf" />
              <button type="button" class="modal-btn modal-btn-ghost" :disabled="searchModalLoading" @click="pdfInput?.click()">{{ $t(pdfFile ? 'add_content.replace_file' : 'add_content.choose_file') }}</button>
            </div>
            <p v-if="pdfFile" class="modal-desc file-name">{{ pdfFile.name }} · {{ (pdfFile.size / 1024 / 1024).toFixed(1) }} MiB</p>
            <p v-if="pdfError" class="modal-error" role="alert">{{ pdfError }}</p>
          </template>
          </section>
          <div class="modal-footer">
            <button class="modal-btn modal-btn-ghost" @click="closeModal" type="button" :disabled="searchModalLoading">{{ $t('common.operate.cancel') }}</button>
            <button class="modal-btn modal-btn-primary" @click="topModalClick" :disabled="(mode === 'file' ? !pdfFile : !addUrlButtonEnable) || searchModalLoading" type="button">
              <div v-if="searchModalLoading" class="i-svg-spinners:90-ring h-14px w-14px"></div>
              <span v-else>{{ $t(mode === 'file' ? 'pdf.upload' : mode === 'feed' ? 'rss.add' : 'component.add_url_top_modal.add_url.button') }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// add-url 支持 local-first
// 启用时本地写入，否则走 REST
import { haveRequestToken } from '~/utils/request'

import { useLocalBookmarks } from '@/composables/bookmark/useLocalBookmarks'
import { isClient } from '@commons/frontend-utils/is'
import { readerBookmarkUuid } from '@slax-reader/contracts'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { PDF_MAX_BYTES } from '@slax-reader/contracts/pdf'
import { isPossibleFeedUrl } from '@slax-reader/contracts/rss'
import Toast, { ToastType } from '~/components/Toast'
import { useBookmarkFork } from '~/composables/bookmark/useBookmarkFork'
import { bookmarkSaveGuardFor } from '~/composables/bookmark/useBookmarkSaveGuard'
import { useLabFeatures } from '~/composables/useLabFeatures'
import { useUserStore } from '~/stores/user'

const props = withDefaults(defineProps<{ initialMode?: 'url' | 'feed' | 'file'; submitFeed?: (url: string, name: string) => Promise<void> }>(), { initialMode: 'url' })
const show = defineModel('show')
const mode = ref<'url' | 'feed' | 'file'>('url')
const feedName = ref('')
const feedError = ref('')
const dismissedFeedUrl = ref('')
const emits = defineEmits(['addUrlSuccess'])

const { t, te } = useI18n()
const forkAction = useBookmarkFork()
const readerConfig = useRuntimeConfig().public
const pdfInput = ref<HTMLInputElement>()
const pdfFile = shallowRef<File | null>(null)
const pdfError = ref('')
const addUrlText = ref('')
const searchModalLoading = ref(false)
const showError = ref(false)
function resetInputState() {
  showError.value = false
  feedError.value = ''
}

// 未启用时不触发查询，安全
const local = useLocalBookmarks()
const user = useUserStore()
const saveGuard = bookmarkSaveGuardFor(user)
// 客户端+登录+PowerSync 可用
const useLocalFirst = () => isClient && haveRequestToken() && isLocalFirstEnabled()
// 实验室开关：local-first 分支不经过服务端，写本地行之前先在这里拦
const labs = useLabFeatures()
const rssEnabled = computed(() => labs.loaded.value && labs.isEnabled('rss'))
const pdfUploadEnabled = computed(() => labs.loaded.value && labs.isEnabled('pdf'))
const tabs = computed(() => ['url', ...(rssEnabled.value ? ['feed'] : []), ...(pdfUploadEnabled.value ? ['file'] : [])] as Array<'url' | 'feed' | 'file'>)
const showFeedHint = computed(() => rssEnabled.value && mode.value === 'url' && trimmedUrl.value !== dismissedFeedUrl.value && isPossibleFeedUrl(trimmedUrl.value))
watch(tabs, available => { if (!available.includes(mode.value)) mode.value = 'url' })
watch(pdfUploadEnabled, enabled => { if (!enabled) pdfFile.value = null })
function tabKeydown(event: KeyboardEvent, tab: 'url' | 'feed' | 'file') {
  const available = tabs.value
  const index = available.indexOf(tab)
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % available.length
  else if (event.key === 'ArrowLeft') next = (index + available.length - 1) % available.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = available.length - 1
  else return
  event.preventDefault()
  mode.value = available[next]!
  nextTick(() => document.getElementById(`add-tab-${mode.value}`)?.focus())
}

watch(
  () => show.value,
  value => {
    mode.value = value && tabs.value.includes(props.initialMode) ? props.initialMode : 'url'
    feedName.value = ''
    feedError.value = ''
    dismissedFeedUrl.value = ''
    addUrlText.value = ''
    pdfFile.value = null
    pdfError.value = ''
    showError.value = false
    if (value) {
      // 打开弹窗时拉一次开关列表，isBlocked 才有依据；拉不到就交给服务端置失败
      if (isClient && !labs.loaded.value) labs.fetch().catch(() => {})
      // 聚焦交由 v-autofocus 指令处理
    }
  },
  { immediate: true }
)

const trimmedUrl = computed(() => addUrlText.value.trim())

const addUrlButtonEnable = computed(() => {
  const url = trimmedUrl.value
  if (!url) return false
  return url.startsWith('http://') || url.startsWith('https://')
})

const selectPdf = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  pdfError.value = ''
  if (!file) return
  pdfFile.value = null
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    pdfError.value = t('pdf.invalid_file')
    return
  }
  if (!file.size || file.size > PDF_MAX_BYTES) {
    pdfError.value = t('pdf.upload_limit')
    return
  }
  pdfFile.value = file
}
const uploadPdf = async () => {
  if (!pdfFile.value || searchModalLoading.value) return
  if (!pdfUploadEnabled.value) {
    labs.showBlockedToast(t('page.user.labs.pdf.blocked'))
    return
  }
  searchModalLoading.value = true
  pdfError.value = ''
  try {
    const result = await request().post<{
      bookmark_id: number
      bookmark_uid: string
    }>({
      url: `/v1/bookmark/upload_pdf?filename=${encodeURIComponent(pdfFile.value.name)}`,
      body: pdfFile.value,
      headers: { 'Content-Type': 'application/pdf' },
      errorInterceptors: err => { if (!labs.handleSaveError(err)) pdfError.value = t('pdf.upload_failed') }
    })
    if (!result?.bookmark_uid) throw new Error('PDF upload returned no bookmark')
    show.value = false
    emits('addUrlSuccess', '')
    await navigateTo(`/b/${result.bookmark_uid}`)
  } catch (error) { if (!(error instanceof Error && error.name === 'LAB_FEATURE_DISABLED')) pdfError.value = t('pdf.upload_failed') }
  finally { searchModalLoading.value = false }
}
const topModalClick = async () => {
  if (searchModalLoading.value) return
  if (mode.value === 'file') {
    await uploadPdf()
    return
  }
  if (mode.value === 'feed') {
    if (!rssEnabled.value || !addUrlButtonEnable.value) return
    searchModalLoading.value = true
    feedError.value = ''
    try {
      if (!props.submitFeed) throw new Error('source_unavailable')
      await props.submitFeed(trimmedUrl.value, feedName.value.trim())
      show.value = false
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      feedError.value = te(`rss.errors.${code}`) ? t(`rss.errors.${code}`) : t('rss.source_error')
    } finally {
      searchModalLoading.value = false
    }
    return
  }
  if (!addUrlButtonEnable.value) {
    showError.value = true
    return
  }
  const targetUrl = trimmedUrl.value
  const sourceUuid = readerBookmarkUuid(targetUrl, [String(readerConfig.PUBLIC_BASE_URL), String(readerConfig.SHARE_BASE_URL)])
  if (sourceUuid) {
    searchModalLoading.value = true
    try {
      if (await forkAction.fork(sourceUuid)) {
        show.value = false
        addUrlText.value = ''
        emits('addUrlSuccess', targetUrl)
      }
    } finally {
      searchModalLoading.value = false
    }
    return
  }
  if (useLocalFirst() && labs.isBlocked(targetUrl)) {
    // 不写本地行：写了会同步上去、被服务端标失败，用户只看到一条失败书签
    labs.showBlockedToast(labs.blockedMessage(targetUrl))
    return
  }
  searchModalLoading.value = true
  try {
    const accountId = user.userInfo?.userId
    const saved = await saveGuard.run(
      String(accountId ?? ''),
      targetUrl,
      () => local.getSaveState(targetUrl),
      async () => {
        if (user.userInfo?.userId !== accountId) throw new Error('Account changed during save')
        if (useLocalFirst()) {
          // 本地写入，列表即时出现
          await local.createBookmark(targetUrl)
        } else {
          await request().post<{ bookmark_id: number; status: string }>({
            url: RESTMethodPath.ADD_URL_BOOKMARK,
            body: { target_url: targetUrl },
            // 替换全局的错误 toast：实验室拦截给一个带“去打开”的 toast，其余照旧只显示文案
            errorInterceptors: err => {
              if (labs.handleSaveError(err)) return
              Toast.showToast({
                text: err instanceof Error ? err.message : String(err),
                type: ToastType.Error
              })
            }
          })
        }
      }
    )
    if (!saved) {
      Toast.showToast({
        text: t('common.operate.loading'),
        type: ToastType.Normal
      })
      return
    }
  } catch {
    // 失败时弹窗留着，用户可以改链接再试
    return
  } finally {
    searchModalLoading.value = false
  }
  show.value = false
  emits('addUrlSuccess', targetUrl)
  addUrlText.value = ''
}

const closeModal = () => {
  if (searchModalLoading.value) return
  show.value = false
}
</script>

<style lang="scss" scoped>
.add-tabs {
  display: flex;
  gap: 20px;
  margin: 12px 0 18px;
  border-bottom: 1px solid var(--slax-border);

  button {
    padding: 10px 0;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--slax-text-muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;

    &.selected {
      color: var(--slax-text);
      border-bottom-color: currentColor;
    }

    &:disabled { opacity: 0.5; cursor: default; }
    &:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
  }
}

.feed-hint {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  font-size: 13px;
  line-height: 1.6;

  p { margin: 0; }
  .hint-actions { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 8px; }
  button { border: 0; padding: 0; background: none; color: inherit; font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  button.muted { color: var(--slax-text-muted); text-decoration: none; }
}

.feed-name-label { display: block; margin: 16px 0 8px; font-size: 13px; }
.file-name { overflow-wrap: anywhere; }

.pdf-upload { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 16px 0 8px; }
.pdf-upload span { color: var(--slax-text-light); font-size: var(--slax-fs-aux); }
.pdf-upload .modal-btn { min-height: 44px; }
@media (max-width: 768px) { .pdf-upload-enabled .modal-btn, .pdf-upload-enabled .modal-close { min-height: 44px; min-width: 44px; } }

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--slax-text) 22%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.modal-dialog {
  width: 480px;
  max-width: 100%;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-warm),
    0 24px 64px color-mix(in srgb, var(--slax-accent) 16%, transparent),
    inset 0 1px 0 var(--slax-inset-hi);
  padding: 24px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.modal-title {
  font-family: var(--slax-font-serif);
  font-size: 18px;
  font-weight: 500;
  color: var(--slax-text);
  margin: 0;
  letter-spacing: 0.01em;
}

.modal-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--slax-radius-sm);
  cursor: pointer;
  color: var(--slax-text-light);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
  }
}

.modal-desc {
  font-size: 12px;
  color: var(--slax-text-light);
  margin: 0 0 16px;
  line-height: 1.6;
}

.modal-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;

  &:focus-within {
    border-color: var(--slax-accent);
    box-shadow: 0 0 0 3px var(--slax-accent-bg);
  }

  &.error {
    border-color: var(--slax-danger);
    background: var(--slax-danger-bg);
  }
}

.modal-input-icon {
  color: var(--slax-text-light);
  flex-shrink: 0;
}

.modal-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-family: inherit;
  font-size: 13px;
  color: var(--slax-text);
  min-width: 0;

  &::placeholder {
    color: var(--slax-text-light);
  }
}

.modal-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 2px 0;
  font-size: 12px;
  color: var(--slax-danger);
  line-height: 1.5;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.modal-btn {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 18px;
  border-radius: var(--slax-radius-sm);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.modal-btn-ghost {
  background: transparent;
  border-color: var(--slax-border);
  color: var(--slax-text-muted);

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
  }
}

.modal-btn-primary {
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  border-color: var(--slax-accent);

  &:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  &:disabled {
    background: color-mix(in srgb, var(--slax-accent) 35%, var(--slax-surface));
    border-color: transparent;
    color: color-mix(in srgb, var(--slax-btn-text) 70%, transparent);
    cursor: not-allowed;
  }
}

// 弹出动画
.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .modal-dialog {
    transform: scale(0.96) translateY(8px);
  }
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.22s ease;

  .modal-dialog {
    transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }
}
</style>
