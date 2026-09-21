<template>
  <div class="share-menu-wrap" ref="wrapEl">
    <button class="share-btn" :class="{ active: isOpen }" :title="$t('common.operate.share')" @click.stop="toggle">
      <!-- 三圆点连线 share icon -->
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
      </svg>
    </button>
    <Transition name="popover">
      <div v-if="isOpen" class="share-popover" v-on-click-outside="close">
        <button class="popover-item" @click="copyLink">
          <span>{{ $t('common.operate.copy_link') }}</span>
          <svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <button class="popover-item" @click="shareTwitter">
          <span>{{ $t('common.operate.share_twitter') }}</span>
          <svg class="item-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </button>
        <!-- 「划线评论可见」owner 专属，非 owner 不显示 -->
        <template v-if="canManageShare">
          <div class="popover-divider" />
          <div class="share-check" :class="{ checked: marksVisible, loading: marksLoading }">
            <span
              class="share-check-box"
              role="checkbox"
              tabindex="0"
              :aria-checked="marksVisible"
              :aria-busy="marksLoading"
              @click="toggleMarksVisible"
              @keydown.enter.prevent="toggleMarksVisible"
              @keydown.space.prevent="toggleMarksVisible"
            >
              <div v-if="marksLoading" class="i-svg-spinners:90-ring share-check-spinner" />
              <svg v-else class="share-check-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span>{{ $t('page.share_detail.marks_visible') }}</span>
          </div>
        </template>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { RESTMethodPath } from '@commons/types/const'
import { vOnClickOutside } from '@vueuse/components'
import Toast, { ToastType } from '~/components/Toast'
import { useExclusivePopover } from '~/composables/useExclusivePopover'

const props = defineProps<{
  // /b/[id] owner 才显示「划线评论可见」开关并落库
  bookmarkUid?: string
  canManageShare?: boolean
  // 非空时附加到推文 text 字段
  twitterText?: string
}>()

const { t } = useI18n()

const { isOpen, toggle, close } = useExclusivePopover()
const marksVisible = ref(true)
// 缓存 show_userinfo，update 时回传避免被覆盖
const shareShowUserinfo = ref(true)
const configLoaded = ref(false)
const marksLoading = ref(false)

type ShareConfig = { allow_action: boolean; show_comment_line: boolean; show_userinfo: boolean; share_code: string }

const loadShareConfig = async () => {
  if (configLoaded.value || !props.canManageShare || !props.bookmarkUid) return
  marksLoading.value = true
  try {
    const res = await request().get<ShareConfig>({ url: RESTMethodPath.EXISTS_SHARE_BOOKMARK, query: { bookmark_uid: props.bookmarkUid } })
    configLoaded.value = true
    if (res) {
      marksVisible.value = !!res.allow_action
      shareShowUserinfo.value = !!res.show_userinfo
    }
  } catch {
  } finally {
    marksLoading.value = false
  }
}

watch(isOpen, open => {
  if (open) loadShareConfig()
})

// 切换「划线评论可见」，经 allow_action 落库
const toggleMarksVisible = async () => {
  if (!props.bookmarkUid || marksLoading.value) return
  const next = !marksVisible.value
  marksVisible.value = next
  configLoaded.value = true
  marksLoading.value = true
  try {
    await request().post({
      url: RESTMethodPath.UPDATE_SHARE_BOOKMARK,
      body: { bookmark_uid: props.bookmarkUid, allow_action: next, show_comment_line: next, show_userinfo: shareShowUserinfo.value }
    })
  } catch {
    marksVisible.value = !next // 回滚
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  } finally {
    marksLoading.value = false
  }
}

const copyLink = async () => {
  try {
    await navigator.clipboard.writeText(location.href)
    Toast.showToast({ text: t('component.share_modal.copy_success'), type: ToastType.Success })
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
  close()
}

const shareTwitter = () => {
  const params = new URLSearchParams({ url: location.href })
  if (props.twitterText) params.set('text', props.twitterText)
  window.open(`https://x.com/intent/tweet?${params.toString()}`, '_blank', 'noopener,noreferrer')
  close()
}
</script>

<style lang="scss" scoped>
.share-menu-wrap {
  --style: relative;
}

// 对齐设计稿 .topbar-icon
.share-btn {
  --style: 'w-34px h-34px flex items-center justify-center rounded-8px cursor-pointer transition-all duration-fast';
  border: none;
  color: var(--slax-text-light);
  background: transparent;

  &:hover,
  &.active {
    color: var(--slax-text);
    background: var(--slax-accent-bg);
  }
}

.share-popover {
  --style: absolute z-200 top-full right-0 mt-8px;
  min-width: 220px;
  padding: 6px;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-warm),
    0 12px 36px color-mix(in srgb, var(--slax-accent) 12%, transparent);

  .popover-item {
    --style: 'w-full flex items-center justify-between gap-12px rounded-8px cursor-pointer transition-all text-left';
    padding: 9px 12px;
    color: var(--slax-text-muted);
    font-size: 14px;
    font-family: inherit;
    background: transparent;
    border: none;

    &:hover {
      background: var(--slax-accent-bg);
      color: var(--slax-text);
    }

    .item-icon {
      width: 15px;
      height: 15px;
      opacity: 0.75;
      flex-shrink: 0;
    }
  }

  .popover-divider {
    --style: my-6px mx-4px;
    height: 1px;
    background: var(--slax-border);
  }

  .share-check {
    --style: flex items-center gap-10px select-none;
    padding: 9px 12px;
    color: var(--slax-text-muted);
    font-size: 13px;

    .share-check-box {
      --style: 'w-14px h-14px flex items-center justify-center flex-none rounded-3px cursor-pointer transition-all';
      border: 1px solid var(--slax-border);
      background: transparent;

      &:hover {
        border-color: var(--slax-accent-soft);
      }
    }

    &.checked .share-check-box {
      background: var(--slax-accent-bg);
      border-color: var(--slax-accent-soft);
    }

    .share-check-tick {
      width: 9px;
      height: 9px;
      color: var(--slax-accent);
      opacity: 0;
      transition: opacity 0.12s;
    }

    &.checked .share-check-tick {
      opacity: 0.7;
    }

    .share-check-spinner {
      width: 10px;
      height: 10px;
      color: var(--slax-accent);
    }

    &.loading .share-check-box {
      cursor: default;
      border-color: var(--slax-accent-soft);
    }
  }
}

.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.popover-enter-active,
.popover-leave-active {
  --style: transition-all duration-fast ease-in-out;
}
</style>
