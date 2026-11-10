<template>
  <section v-if="showCollection" ref="promptRef" class="starred-share-prompt" aria-live="polite">
    <div class="starred-share-content">
      <span class="starred-share-status">{{ $t('page.bookmarks_index.starred_share.status_open') }}</span>

      <div class="starred-share-enabled-header">
        <h3 class="starred-share-title">{{ displayName }}</h3>
        <span class="starred-share-subscriber-count">
          {{ $t('page.bookmarks_index.starred_share.subscriber_count', { count: info?.subscriber_count ?? 0 }) }}
        </span>
      </div>

      <p v-if="openDescription" class="starred-share-desc">{{ openDescription }}</p>
    </div>

    <div class="starred-share-actions">
      <button
        ref="shareBtnRef"
        class="starred-share-outline-btn starred-share-icon-btn"
        type="button"
        :aria-label="$t('page.bookmarks_index.starred_share.share')"
        :title="$t('page.bookmarks_index.starred_share.share')"
        @click="shareCollection"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
        </svg>
      </button>
      <button class="starred-share-outline-btn" type="button" @click="viewCollection">
        {{ $t('page.bookmarks_index.starred_share.view_collection') }}
      </button>
    </div>
  </section>

  <div v-else-if="showMini" class="starred-share-mini-entry">
    <span class="starred-share-mini-copy">{{ $t('page.bookmarks_index.starred_share.mini_copy') }}</span>
    <span class="starred-share-mini-divider" aria-hidden="true"></span>
    <button class="starred-share-mini-btn" type="button" :disabled="reopening" @click="reopenCollection">
      {{ $t('page.bookmarks_index.starred_share.mini_cta') }}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="starred-share-mini-arrow">
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </svg>
    </button>
  </div>
</template>

<script lang="ts" setup>
import { copyText } from '@commons/frontend-utils/string'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { UserEnableCollectShare } from '@slax-reader/contracts/interface'
import CursorToast from '~/components/CursorToast'
import Toast, { ToastType } from '~/components/Toast'
import { useShareCollectInfo } from '~/composables/useShareCollectInfo'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const $config = useNuxtApp().$config.public

const { info, loaded, ensure, refresh } = useShareCollectInfo()
const userStore = useUserStore()

const reopening = ref(false)
const promptRef = ref<HTMLElement>()
const shareBtnRef = ref<HTMLElement>()

const isOpen = computed(() => info.value?.status === 1)
const hasCollection = computed(() => loaded.value && !!info.value?.collection_code)
const showCollection = computed(() => hasCollection.value && isOpen.value)
const showMini = computed(() => hasCollection.value && !isOpen.value)

const displayName = computed(
  () => info.value?.show_name?.trim() || t('page.collection_manage.default_name', { name: userStore.userInfo?.name ?? '' })
)
const openDescription = computed(() => info.value?.description?.trim() || t('page.bookmarks_index.starred_share.default_desc'))
const collectionUrl = computed(() => `${$config.SHARE_BASE_URL || ''}/c/${info.value?.collection_code ?? ''}`)

const shareCollection = async () => {
  if (!info.value?.collection_code) {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
    return
  }

  try {
    await copyText(collectionUrl.value)
    if (shareBtnRef.value) {
      CursorToast.showToast({
        text: t('page.bookmarks_index.starred_share.copied'),
        trackDom: shareBtnRef.value,
        baseContainer: promptRef.value
      })
    }
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
}

// external:true 强制整页跳转，避免 SPA 路由绕过 /c/[id] 的 SSR 逻辑
const viewCollection = () => {
  if (info.value?.collection_code) navigateTo(collectionUrl.value, { external: true })
}

const reopenCollection = async () => {
  if (reopening.value) return
  reopening.value = true
  try {
    const res = await request().post<UserEnableCollectShare>({
      url: RESTMethodPath.USER_INFO_ENABLE_SETTING,
      body: { key: 'share_collect' }
    })
    if (!res) throw new Error('reopen failed')

    // The enable route restores the existing row/code. Merge immediately so a slow or failed
    // /mine refresh cannot leave the closed guidance in place after the server reopened it.
    if (info.value) info.value = { ...info.value, ...res, status: res.status ?? 1 }
    await refresh()
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  } finally {
    reopening.value = false
  }
}

onMounted(ensure)
</script>

<style lang="scss" scoped>
.starred-share-prompt {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  column-gap: 32px;
  row-gap: 16px;
  margin: 0 0 16px;
  padding: 16px 4px 24px;
  border-bottom: 1px solid var(--slax-border);

  // 提示容器脱流，避免撑高
  :deep(.cursor-toast-container) {
    position: absolute;
    top: 0;
    left: 0;
  }
}

.starred-share-content {
  min-width: 0;
  width: 100%;
}

.starred-share-status {
  display: inline-flex;
  align-items: center;
  max-width: 180px;
  margin-bottom: 8px;
  padding: 2px 10px;
  border-radius: 20px;
  background: var(--slax-accent-bg);
  color: var(--slax-accent);
  font-size: 12px;
  line-height: 1.5;
}

.starred-share-enabled-header {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 8px;
}

.starred-share-title {
  margin: 0;
  color: var(--slax-text);
  font-size: 18px;
  font-weight: 500;
  line-height: 1.45;
}

.starred-share-subscriber-count {
  color: var(--slax-text-light);
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
}

.starred-share-desc {
  margin: 0;
  color: var(--slax-text-muted);
  font-size: 14px;
  line-height: 1.75;
}

.starred-share-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  align-self: center;
  gap: 8px;
}

.starred-share-outline-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: var(--slax-text-muted);
  font: inherit;
  font-size: 14px;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--slax-accent-bg);
    border-color: var(--slax-accent-soft);
    color: var(--slax-accent);
  }

  &:focus-visible {
    outline: 2px solid var(--slax-accent);
    outline-offset: 2px;
  }
}

.starred-share-icon-btn {
  min-width: 40px;
  width: 40px;
  height: 40px;
  padding: 0;

  svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
}

.starred-share-mini-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  margin: 0 0 8px;
  padding: 0 4px 0 60px;
  color: var(--slax-text-light);
  font-size: 13px;
  line-height: 1;
}

.starred-share-mini-copy {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.starred-share-mini-divider {
  width: 1px;
  height: 12px;
  background: var(--slax-border);
  flex-shrink: 0;
}

.starred-share-mini-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--slax-accent);
  font: inherit;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 0.82;
  }

  .starred-share-mini-arrow {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
}

@media (max-width: 768px) {
  .starred-share-prompt {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 16px;
    padding: 16px 4px 20px;
  }

  .starred-share-actions {
    justify-content: flex-start;
  }

  .starred-share-outline-btn {
    min-height: 44px;
  }

  .starred-share-mini-entry {
    padding: 0 4px;
  }
}

@media (max-width: 520px) {
  .starred-share-prompt {
    row-gap: 12px;
  }

  .starred-share-actions {
    flex-wrap: wrap;
  }

  .starred-share-outline-btn {
    flex: 1 1 auto;
  }

  .starred-share-icon-btn {
    flex: 0 0 44px;
    width: 44px;
  }
}
</style>
