<template>
  <div class="mobile-notes-entry">
    <!-- 欢迎 banner：点击/超时收起 -->
    <div class="notes-welcome" :class="{ dismissed: phase !== 'banner' }" role="button" tabindex="0" @click="onBannerClick" @keydown.enter="onBannerClick">
      <div class="welcome-avatar">
        <img v-if="avatar" :src="avatar" alt="" />
        <span v-else-if="avatarLetter">{{ avatarLetter }}</span>
        <span v-else class="welcome-avatar-icon" v-html="commentIcon" />
      </div>
      <div class="welcome-body">
        <div class="welcome-title">{{ title }}</div>
      </div>
      <button class="welcome-close" :aria-label="$t('common.operate.cancel')" @click.stop="dismiss">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- 常驻 pill：x 条笔记 -->
    <div class="notes-pill-area" :class="{ visible: phase === 'pill' }">
      <button class="notes-pill" @click="onPillClick">
        <span class="pill-icon" v-html="commentIcon" />
        {{ countText }}
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
const props = defineProps<{
  count: number
  author?: string
  avatar?: string
}>()

const emit = defineEmits<{
  open: []
}>()

const { t } = useI18n()

// banner 自动收起延时(ms)
const AUTO_DISMISS_DELAY = 4000

// 两态；useState 持久化防重挂载重置
// key 按 uuid：每篇各弹一次
const route = useRoute()
const phase = useState<'banner' | 'pill'>(`snapshot-mobile-notes-phase:${route.params.id}`, () => 'banner')
let timer: ReturnType<typeof setTimeout> | null = null

const clearTimer = () => {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

const dismiss = () => {
  clearTimer()
  phase.value = 'pill'
}

const onBannerClick = () => {
  dismiss()
  emit('open')
}

const onPillClick = () => emit('open')

onMounted(() => {
  // 收起过则不再弹
  if (phase.value !== 'banner') {
    return
  }
  // 自动收起为 pill
  clearTimer()
  timer = setTimeout(dismiss, AUTO_DISMISS_DELAY)
})

onUnmounted(() => {
  clearTimer()
})

const avatarLetter = computed(() => (props.author?.trim()?.[0] ?? '').toUpperCase())
const countText = computed(() => t('page.bookmarks_detail.notes_count', { count: props.count }))
const title = computed(() => (props.author ? t('page.bookmarks_detail.notes_by', { author: props.author, count: props.count }) : countText.value))

const commentIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4z"/></svg>`
</script>

<style lang="scss" scoped>
// ── 欢迎 banner ──
.notes-welcome {
  position: fixed;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%) translateY(0);
  width: min(calc(100vw - 32px), 420px);
  z-index: 21;

  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;

  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: 14px;
  box-shadow: var(--slax-shadow-warm);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);

  cursor: pointer;
  opacity: 1;
  transition:
    opacity 0.4s,
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);

  &.dismissed {
    opacity: 0;
    transform: translateX(-50%) translateY(12px);
    pointer-events: none;
  }
}

.welcome-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--slax-accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .welcome-avatar-icon :deep(svg) {
    width: 16px;
    height: 16px;
  }
}

.welcome-body {
  flex: 1;
  min-width: 0;
}

.welcome-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--slax-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.welcome-close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: var(--slax-accent-bg);
  color: var(--slax-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s;

  &:hover {
    color: var(--slax-text);
  }

  svg {
    width: 12px;
    height: 12px;
  }
}

// ── 常驻 pill ──
.notes-pill-area {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;

  // 底部渐变，柔化边界
  padding: 6px 14px calc(24px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(to top, var(--slax-surface-solid, var(--slax-bg, var(--slax-surface))) 55%, transparent);

  display: flex;
  justify-content: center;
  // 渐变区不拦点击
  pointer-events: none;

  opacity: 0;
  transition: opacity 0.35s 0.15s;

  &.visible {
    opacity: 1;
  }
}

.notes-pill {
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;

  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: 16px;
  box-shadow: var(--slax-shadow-warm);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);

  color: var(--slax-text-muted);
  font-size: 13px;
  font-family: inherit;
  white-space: nowrap;
  transition:
    transform 0.15s,
    color 0.15s;

  &:hover {
    color: var(--slax-text);
  }

  &:active {
    transform: scale(0.96);
  }

  .pill-icon {
    flex-shrink: 0;
    display: flex;

    :deep(svg) {
      width: 15px;
      height: 15px;
    }
  }
}
</style>
