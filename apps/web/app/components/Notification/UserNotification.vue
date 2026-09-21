<template>
  <div class="user-notification" ref="userNotification">
    <div class="notification-icon" ref="notificationIcon" :class="{ tiny: iconStyle === UserNotificationIconStyle.TINY }" @click="iconClick">
      <slot name="icon">
        <img src="@images/tiny-notification-outline-icon.png" alt="" />
      </slot>
    </div>
    <Transition name="opacity">
      <i class="dot" v-show="unreadCount > 0"></i>
    </Transition>
    <Transition name="opacity">
      <div class="notification-bubble" ref="bubble" v-show="showMessageBubble" v-on-click-outside="clickOutSide">
        <div class="notification-header">
          <span>{{ $t('component.user_notification.title') }}</span>
          <div class="flex items-center">
            <button class="check-all" @click="checkAll">{{ $t('common.operate.view_source_all') }}</button>
            <button class="close" @click="showMessageBubble = false">
              <img src="@images/button-dialog-close.png" />
            </button>
          </div>
        </div>
        <Transition name="loading">
          <div class="loading" v-show="loading">
            <div class="i-svg-spinners:90-ring text-h2 text-accent"></div>
          </div>
        </Transition>
        <div class="empty" v-if="notifications.length === 0">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--slax-text-light); opacity: 0.4">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
          <span>{{ $t('component.user_notification.no_message') }}</span>
        </div>
        <div class="notification-messages" v-else>
          <NotificationCell v-for="notification in notifications" :key="notification.id" :notification="notification" :style="NotificationCellStyle.SIMPLE" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts">
export enum UserNotificationIconStyle {
  NORMAL = 0,
  TINY = 1
}
</script>

<script lang="ts" setup>
// 用 alias，否则绕过 fork 覆盖
import NotificationCell, { NotificationCellStyle } from '~/components/Notification/NotificationCell.vue'

import { isSafari } from '@commons/utils/is'

import { RESTMethodPath } from '@commons/types/const'
import type { UserNotificationMessageItem } from '@commons/types/interface'
import { vOnClickOutside } from '@vueuse/components'
import { LocalFirstAdapterKey } from '~/composables/local-first/injection'
import type { Ref } from 'vue'

defineProps({
  bubbleXOffset: {
    type: Number,
    default: 0,
    required: false
  },
  iconStyle: {
    type: Number,
    default: UserNotificationIconStyle.NORMAL,
    required: false
  }
})

const emits = defineEmits(['checkAll'])

const notification = useNotification()

// 未读数/列表来源 + 传输方式
// 默认 sw，fork 下发 feed + rest
const lf = inject(LocalFirstAdapterKey, null)
const rt = lf?.notificationRuntime?.() ?? { feed: null, unreadTransport: 'sw' as const }
const feed = rt.feed
const localEnabled = !!feed

const unreadCount = feed ? feed.unreadCount : ref(0)
const showMessageBubble = ref(false)
const notifications = feed ? feed.items : ref<UserNotificationMessageItem[]>([])
const loading = ref(false)
const userNotification = ref<HTMLDivElement>()
const notificationIcon = ref<HTMLDivElement>()
const bubble = ref<HTMLDivElement>()

const defaultValue = {
  bubbleWidth: 360,
  leftOffset: -220
}

const bubbleWidth = ref(`${defaultValue.bubbleWidth}px`)
const leftOffset = ref(`${defaultValue.leftOffset}`)
const isRequestedPermission = ref(false)

watch(
  () => showMessageBubble.value,
  value => {
    if (value) {
      checkAndQueryNotifications()

      resizeUpdate()
    }
  }
)

onMounted(() => {
  addListener()
})

onUnmounted(() => {
  removeListener()
})

const resizeUpdate = () => {
  if (!showMessageBubble.value) {
    return
  }

  const eleRect = document.body.getBoundingClientRect()
  const rect = userNotification.value?.getBoundingClientRect()

  if (bubble.value && eleRect && rect) {
    const width = Math.min(defaultValue.bubbleWidth, eleRect.width)
    const defaultX = rect.left - Math.abs(defaultValue.leftOffset)
    const maxX = defaultX + width

    if (maxX > eleRect.width + eleRect.left) {
      const gap = maxX - eleRect.width - eleRect.left
      const xOffset = Math.max(defaultX - gap, 0)
      leftOffset.value = `-${rect.left - xOffset}px`
    } else if (defaultX < eleRect.left) {
      const gap = eleRect.left - defaultX
      const xOffset = Math.max(defaultX - gap, 0)
      leftOffset.value = `-${rect.left - xOffset}px`
    } else {
      leftOffset.value = `${defaultValue.leftOffset}px`
    }

    bubbleWidth.value = `${width}px`
  }
}

const debounceResize = useDebounceFn(resizeUpdate, 100, { maxWait: 5000 })

const iconClick = () => {
  showMessageBubble.value = !showMessageBubble.value

  if (showMessageBubble.value && isSafari() && !isRequestedPermission.value) {
    isRequestedPermission.value = true
    notification.requestPushPermission()
  }
}

const clickOutSide = (event?: PointerEvent) => {
  if (event?.target) {
    const target = event.target as HTMLElement
    if (notificationIcon.value?.contains(target)) {
      return
    }
  }

  if (!showMessageBubble.value) {
    return
  }

  showMessageBubble.value = false
}

const checkAll = async () => {
  emits('checkAll')

  if (feed) {
    // 本地置已读，未读数响应式归零
    await feed.markAllRead()
  } else {
    ;(unreadCount as Ref<number>).value = 0
  }
  showMessageBubble.value = false
}

const addListener = () => {
  window.addEventListener('resize', debounceResize)
}

const removeListener = () => {
  window.removeEventListener('resize', debounceResize)
}

const checkAndQueryNotifications = async () => {
  if (localEnabled) return // LF：列表响应式，不拉取
  const list = notifications as Ref<UserNotificationMessageItem[]>
  if (!showMessageBubble.value || ((unreadCount as Ref<number>).value === 0 && list.value.length)) {
    return
  }

  loading.value = true

  try {
    const res = await request().get<UserNotificationMessageItem[]>({
      url: RESTMethodPath.NOTIFICATION_LIST,
      query: {
        page: 1,
        page_size: 10
      }
    })

    if (res) {
      list.value = res || []
    }
  } finally {
    loading.value = false
  }
}

if (rt.unreadTransport === 'sw') {
  // upstream：SW 推未读，不支持则 REST
  if (notification.isSupportedNotification) {
    notification.registerWorker().then(res => {
      notification.onMessage(event => {
        console.log('event', event)
        if (typeof event?.data === 'string') {
          const data = JSON.parse(event?.data)
          ;(unreadCount as Ref<number>).value = data?.unreadCount || 0
        }
      })

      notification.sendMessage({
        type: 'ready'
      })
    })
  } else {
    request()
      .get<{ unread_count: number }>({
        url: RESTMethodPath.GET_UNREAD_COUNT
      })
      .then(res => {
        ;(unreadCount as Ref<number>).value = res?.unread_count || 0
      })
  }
} else {
  // fork：仅注册 SW，不推未读
  // 未读数走 feed 或 REST
  if (notification.isSupportedNotification) {
    notification.registerWorker().catch(error => console.error('[slax] registerWorker failed:', error))
  }
  if (!localEnabled) {
    request()
      .get<{ unread_count: number }>({
        url: RESTMethodPath.GET_UNREAD_COUNT
      })
      .then(res => {
        ;(unreadCount as Ref<number>).value = res?.unread_count || 0
      })
  }
}
</script>

<style lang="scss" scoped>
.user-notification {
  --style: relative;
  .notification-icon {
    --style: flex w-24px h-24px cursor-pointer;
    img {
      --style: object-fit;
    }

    &.tiny {
      --style: w-16px h-16px;
    }
  }

  .dot {
    // bg-#f6af69 通知未读橙色提示点，保留
    --style: absolute top-0 right-0 w-5px h-5px rounded-full bg-#f6af69;
  }

  .notification-bubble {
    position: absolute;
    top: calc(100% + 10px);
    border-radius: var(--slax-radius);
    z-index: 200;
    background: var(--slax-surface-solid);
    border: 1px solid var(--slax-border);
    box-shadow:
      var(--slax-shadow-warm),
      0 12px 36px color-mix(in srgb, var(--slax-accent) 12%, transparent);
    transition: all var(--slax-dur-normal);

    width: v-bind(bubbleWidth);
    left: v-bind(leftOffset);

    .notification-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      height: 52px;
      border-bottom: 1px solid var(--slax-border);

      span {
        font-size: 14px;
        font-weight: 600;
        color: var(--slax-text);
        line-height: 1.4;
      }

      .check-all {
        font-size: 13px;
        color: var(--slax-accent);
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: var(--slax-radius-sm);
        transition: all 0.12s;
        font-family: inherit;

        &:hover {
          background: var(--slax-accent-bg);
        }
      }

      .close {
        display: none;
        margin-left: 8px;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        border-radius: var(--slax-radius-sm);
        cursor: pointer;
        color: var(--slax-text-light);
        transition: all 0.12s;

        @media (max-width: 768px) {
          display: flex;
        }

        &:hover {
          background: var(--slax-surface);
          color: var(--slax-text);
        }

        img {
          width: 14px;
          height: auto;
          object-fit: contain;
        }
      }
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 50px;
      overflow: hidden;
      max-height: 50px;
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 240px;
      padding: 24px;

      img {
        width: 48px;
        object-fit: contain;
        opacity: 0.4;
      }

      span {
        margin-top: 16px;
        font-size: 13px;
        color: var(--slax-text-light);
        line-height: 1.5;
      }
    }

    .notification-messages {
      padding: 8px;
      max-height: 400px;
      overflow-y: auto;
      scrollbar-width: none;

      &::-webkit-scrollbar {
        display: none;
      }
    }
  }
}

.loading-enter-active,
.loading-leave-active {
  transition: all 0.4s;
}

.loading-enter-from,
.loading-leave-to {
  --style: '!max-h-0 opacity-0';
}
</style>
