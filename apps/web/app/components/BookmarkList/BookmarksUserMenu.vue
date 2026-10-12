<template>
  <!-- 头像 + popover 菜单，复用 useExclusivePopover 互斥逻辑 -->
  <div class="user-menu-wrap" @mouseenter="openOnHover" @mouseleave="closeOnHover">
    <!-- 头像按钮 -->
    <button class="user-avatar" :class="{ active: isOpen }" @click.stop="openOnHover" type="button">
      <img :src="userStore.userInfo?.picture || defaultAvatarUrl" alt="" />
    </button>

    <!-- popover 菜单 -->
    <Transition name="popover">
      <div v-if="isOpen" class="user-popover" v-on-click-outside="close">
        <!-- 个人信息 -->
        <button class="popover-item" @click="goProfile">
          <span>{{ $t('component.user_operate_icon.personal_info') }}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </button>

        <!-- 反馈 -->
        <button class="popover-item" @click="onFeedback">
          <span>{{ $t('common.operate.feedback') }}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>

        <div class="popover-divider" />

        <!-- 退出登录 -->
        <button class="popover-item danger" @click="logout">
          <span>{{ $t('component.user_operate_icon.logout') }}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { vOnClickOutside } from '@vueuse/components'
import { useExclusivePopover } from '~/composables/useExclusivePopover'
import { useUserStore } from '~/stores/user'

const emit = defineEmits<{
  feedback: []
}>()

const { isOpen, close } = useExclusivePopover()
const userStore = useUserStore()
const auth = useAuth()

// 默认头像 URL（与 UserOperateIcon 保持一致）
const defaultAvatarUrl = new URL('@images/user-default-avatar.png', import.meta.url).href
let closeTimer: ReturnType<typeof setTimeout> | undefined

const openOnHover = () => {
  if (closeTimer) clearTimeout(closeTimer)
  isOpen.value = true
}

const closeOnHover = () => {
  closeTimer = setTimeout(() => close(), 120)
}

// 跳转个人信息页
const goProfile = () => {
  close()
  navigateTo('/user')
}

// 触发反馈事件
const onFeedback = () => {
  close()
  emit('feedback')
}

// 退出登录
const logout = () => {
  close()
  auth.clearAuth()
  navigateTo('/login', { replace: true })
}
</script>

<style lang="scss" scoped>
.user-menu-wrap {
  position: relative;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid var(--slax-accent-soft);
  overflow: hidden;
  cursor: pointer;
  background: transparent;
  padding: 0;
  transition: border-color 0.15s;
  flex-shrink: 0;

  &:hover,
  &.active {
    border-color: var(--slax-accent);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.user-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 160px;
  padding: 6px;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-warm),
    0 12px 36px color-mix(in srgb, var(--slax-accent) 12%, transparent);
  z-index: 200;
}

.popover-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 9px 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  color: var(--slax-text-muted);
  font-size: 13px;
  font-family: inherit;
  transition: all 0.12s;
  text-align: left;

  svg {
    flex-shrink: 0;
    opacity: 0.75;
  }

  &:hover {
    background: var(--slax-accent-bg);
    color: var(--slax-text);
  }

  &.danger {
    color: var(--slax-danger);

    &:hover {
      background: var(--slax-danger-bg, color-mix(in srgb, var(--slax-danger) 10%, transparent));
    }
  }
}

.popover-divider {
  height: 1px;
  background: var(--slax-border);
  margin: 4px 6px;
}

// popover 动画（与 SnapshotMoreMenu 保持一致）
.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.popover-enter-active,
.popover-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
</style>
