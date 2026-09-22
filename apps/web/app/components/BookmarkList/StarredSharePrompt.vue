<template>
  <section v-if="showPrompt" ref="promptRef" class="starred-share-prompt" :class="{ 'is-collection-enabled': enabled }" aria-live="polite">
    <div class="starred-share-icon" aria-hidden="true">
      <svg v-if="!enabled" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
    </div>

    <!-- 未开启：引导开启 -->
    <template v-if="!enabled">
      <div class="starred-share-content">
        <h3 class="starred-share-title">{{ $t('page.bookmarks_index.starred_share.title') }}</h3>
        <p class="starred-share-desc">{{ $t('page.bookmarks_index.starred_share.desc') }}</p>
      </div>
      <div class="starred-share-actions">
        <button class="starred-share-cta" type="button" @click="openEnableModal">
          {{ $t('page.bookmarks_index.starred_share.enable') }}
        </button>
        <button class="starred-share-dismiss" type="button" @click="dismiss">
          {{ $t('page.bookmarks_index.starred_share.dismiss') }}
        </button>
      </div>
    </template>

    <!-- 已开启 -->
    <template v-else>
      <div class="starred-share-content">
        <span class="starred-share-status">{{ $t('page.bookmarks_index.starred_share.status_enabled') }}</span>
        <div class="starred-share-enabled-header">
          <h3 class="starred-share-title">{{ info?.show_name }}</h3>
          <span class="starred-share-subscriber-count">
            {{ $t('page.bookmarks_index.starred_share.subscriber_count', { count: info?.subscriber_count ?? 0 }) }}
          </span>
        </div>
        <p v-if="info?.description" class="starred-share-desc">{{ info.description }}</p>
      </div>
      <div class="starred-share-actions starred-share-enabled-actions">
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
        <button class="starred-share-outline-btn" type="button" @click="viewCollection()">
          {{ $t('page.bookmarks_index.starred_share.view_collection') }}
        </button>
      </div>
    </template>
  </section>

  <!-- 暂不开启后降级的一行入口 -->
  <div v-else-if="showMini" class="starred-share-mini-entry">
    <span class="starred-share-mini-copy">{{ $t('page.bookmarks_index.starred_share.mini_copy') }}</span>
    <span class="starred-share-mini-divider" aria-hidden="true"></span>
    <button class="starred-share-mini-btn" type="button" @click="openEnableModal">
      {{ $t('page.bookmarks_index.starred_share.mini_cta') }}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="starred-share-mini-arrow">
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </svg>
    </button>
  </div>

  <!-- 开启合集：表单 → 成功弹窗 -->
  <EnableCollectionModal
    v-if="showEnableModal"
    :current-name="info?.show_name ?? ''"
    :default-name="defaultCollectionName"
    @dismiss="showEnableModal = false"
    @success="refresh"
    @view="viewCollection"
  />
</template>

<script lang="ts" setup>
import EnableCollectionModal from '~/components/Collection/CollectionModal/EnableCollectionModal.vue'

import { copyText } from '@commons/frontend-utils/string'

import { useStorage } from '@vueuse/core'
import CursorToast from '~/components/CursorToast'
import Toast, { ToastType } from '~/components/Toast'
import { useUserStore } from '~/stores/user'

// 星标数；兜底 /mine 返回 null
const props = defineProps<{ starredCount?: number }>()

const { t } = useI18n()
const $config = useNuxtApp().$config.public

// 达此值才引导开启
const STARRED_SHARE_THRESHOLD = 10

// 共享缓存，跨切换秒开
const { info, loaded, ensure, refresh } = useShareCollectInfo()
const userStore = useUserStore()
// dismiss 按用户 id 持久化
// key 待 userInfo 到位重键，避免串味
const dismissed = useStorage(() => `slax:starred-share-dismissed:${userStore.userInfo?.userId ?? 'anon'}`, false)

// 默认合集名，留空兜底
const defaultCollectionName = computed(() => t('page.collection_manage.default_name', { name: userStore.userInfo?.name ?? '' }))
const showEnableModal = ref(false)
const promptRef = ref<HTMLElement>()
const shareBtnRef = ref<HTMLElement>()

const enabled = computed(() => info.value?.status === 1 && !!info.value?.collection_code)
// 优先本地实时星标数，/mine 计数仅兜底
const effectiveCount = computed(() => props.starredCount ?? info.value?.starred_count ?? 0)
const canSetup = computed(() => effectiveCount.value >= STARRED_SHARE_THRESHOLD)

const showPrompt = computed(() => loaded.value && (enabled.value || (canSetup.value && !dismissed.value)))
const showMini = computed(() => loaded.value && !enabled.value && canSetup.value && dismissed.value)

const shareUrl = computed(() => `${$config.SHARE_BASE_URL || ''}/c/${info.value?.collection_code ?? ''}`)

const openEnableModal = () => (showEnableModal.value = true)

const dismiss = () => (dismissed.value = true)

const shareCollection = async () => {
  try {
    await copyText(shareUrl.value)
    // 复制提示贴在分享按钮旁
    if (shareBtnRef.value) {
      CursorToast.showToast({ text: t('page.bookmarks_index.starred_share.copied'), trackDom: shareBtnRef.value, baseContainer: promptRef.value })
    }
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
}

// 当前页跳转；优先弹窗 code，兜底 info
// external:true 强制整页跳转，避免 SPA 路由绕过 /c/[id] 的 SSR 逻辑
const viewCollection = (code?: string) => {
  const target = code || info.value?.collection_code
  if (target) navigateTo(`/c/${target}`, { external: true })
}

onMounted(ensure)
</script>

<style lang="scss" scoped>
.starred-share-prompt {
  position: relative;
  display: grid;

  // 提示容器脱流，避免撑高
  :global(.cursor-toast-container) {
    position: absolute;
    top: 0;
    left: 0;
  }

  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: flex-start;
  column-gap: 32px;
  row-gap: 16px;
  /* 32+16=48，对齐左栏首个 tab 文字 */
  margin: 0 0 16px;
  padding: 16px 4px 40px;
  border-bottom: 1px solid var(--slax-border);

  @media (max-width: 768px) {
    display: none;
  }
}

.starred-share-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--slax-accent);
  opacity: 0.8;

  svg {
    width: 18px;
    height: 18px;
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
  margin: 0 0 8px;
  color: var(--slax-text);
  font-size: 18px;
  font-weight: 500;
  line-height: 1.45;
}

.starred-share-enabled-header .starred-share-title {
  margin: 0;
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
  grid-column: 2;
  display: flex;
  align-items: center;
  gap: 24px;
}

.starred-share-enabled-actions {
  grid-column: 3;
  grid-row: 1;
  justify-self: end;
  align-self: center;
  gap: 8px;
}

.starred-share-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  border: 1px solid var(--slax-accent);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition:
    opacity 0.15s,
    transform 0.15s;

  &:hover:not(:disabled) {
    opacity: 0.92;
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.starred-share-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0;
  border: none;
  background: transparent;
  color: var(--slax-text-light);
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s;

  &:hover {
    color: var(--slax-text-muted);
  }
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
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--slax-accent-bg);
    border-color: var(--slax-accent-soft);
    color: var(--slax-accent);
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

  @media (max-width: 768px) {
    display: none;
  }
}

.starred-share-mini-copy {
  white-space: nowrap;
}

.starred-share-mini-divider {
  width: 1px;
  height: 12px;
  background: var(--slax-border);
  flex-shrink: 0;
}

.starred-share-mini-btn {
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
</style>
