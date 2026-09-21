<template>
  <div class="notification-cell" :class="{ normal: style === NotificationCellStyle.NORMAL, simple: style === NotificationCellStyle.SIMPLE }" @click="handleClick">
    <template v-if="style === NotificationCellStyle.NORMAL">
      <div class="notification-header">
        <div class="left">
          <img :src="notification.icon" alt="" />
          <span class="highlighted" v-if="notification.type === 'reply'">{{ $t('component.notification_cell.reply_title', { username: notification.username }) }}</span>
          <span v-else>{{ notification.title }}</span>
        </div>
        <div class="right">{{ publishTime }}</div>
      </div>
      <div class="notification-content" v-if="notification.content || notification.quote_content">
        <div class="comment" v-if="!notification.quote_content">
          <span class="comment-text">{{ notification.content }}</span>
        </div>
        <div class="reply" v-else>
          <div class="reply-text">{{ notification.content }}</div>
          <div class="reply-comment">
            <span>{{ notification.quote_content }}</span>
          </div>
        </div>
      </div>
      <div class="notification-footer">
        <div class="link" v-if="notification.bookmark_title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          </svg>
          <span>{{ notification.bookmark_title }}</span>
        </div>
        <button>{{ $t('common.operate.view_source') }}</button>
      </div>
    </template>
    <template v-else-if="style === NotificationCellStyle.SIMPLE">
      <div class="notification-header">
        <div class="left">
          <img :src="notification.icon" alt="" />
          <span class="highlighted" v-if="notification.type === 'reply'">{{ $t('component.notification_cell.reply_title', { username: notification.username }) }}</span>
          <span v-else>{{ notification.title }}</span>
        </div>
        <div class="right">
          <span>{{ publishTime }}</span>
        </div>
      </div>
      <div class="notification-content">
        <div class="comment" v-if="!notification.quote_content">
          <span class="comment-text">{{ notification.content }}</span>
          <div class="link" v-if="notification.bookmark_title">
            <i></i>
            <span>{{ notification.bookmark_title }}</span>
          </div>
        </div>
        <div class="reply" v-else>
          <div class="reply-text">{{ notification.content }}</div>
          <div class="reply-comment">
            <span>{{ notification.quote_content }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
export enum NotificationCellStyle {
  SIMPLE = 'simple',
  NORMAL = 'normal'
}
</script>

<script lang="ts" setup>
import { RESTMethodPath } from '@commons/types/const'
import type { UserNotificationMessageItem } from '@commons/types/interface'

const props = defineProps({
  notification: {
    type: Object as PropType<UserNotificationMessageItem>,
    required: true
  },
  style: {
    type: String as PropType<NotificationCellStyle>,
    default: NotificationCellStyle.NORMAL
  }
})

const { t } = useI18n()

const $config = useRuntimeConfig().public

const publishTime = computed(() => {
  const now = new Date()
  const publishTime = new Date(props.notification.created_at)
  const diffTime = now.getTime() - publishTime.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  // xx小时前 / xx分钟前 / 刚刚
  if (diffDays === 0) {
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60))
    if (diffHours > 0) {
      return `${diffHours} ${t('component.article_selection.hours_ago')}`
    }
    const diffMinutes = Math.floor(diffTime / (1000 * 60))
    if (diffMinutes > 0) {
      return `${diffMinutes} ${t('component.article_selection.minutes_ago')}`
    }
    return t('component.article_selection.just_now')
  }
  return publishTime.toDateString()
})

const handleClick = (): void => {
  const notification = props.notification
  const objectData = notification.object_data
  const { type, source, is_read: isRead, id } = notification
  const notificationParam = isRead ? '' : `&notification_id=${id}`

  const getCommentUrl = (): string => {
    const baseUrl = source === 'share' ? `/s/${objectData.share_code}` : `/c/${objectData.collection_code}/${objectData.cb_id}`
    return `${baseUrl}?highlight=${objectData.comment_id}${notificationParam}`
  }

  const markNotificationRead = async () => {
    if (!id || isRead) return
    await request().post({ url: RESTMethodPath.NOTIFICATION_MARK_READ, body: { id } })
  }

  const urlMap: Record<string, () => string> = {
    comment: getCommentUrl,
    reply: getCommentUrl,
    collection_update: () => `/c/${objectData.collection_code}/${objectData.bookmark_id}`,
    collection_price_change: () => `/c/${objectData.collection_code}`
  }

  const jumpUrl = urlMap[type]?.()
  if (!jumpUrl) return
  markNotificationRead()
  window.open(jumpUrl, '_blank')
}
</script>

<style lang="scss" scoped>
.notification-cell {
  --style: 'cursor-pointer select-none';

  // NORMAL：与 BookmarkHighlightCell 同一套卡片语言（surface 卡片 + 细边 + inset 高光 + hover 微浮），
  // 二者共用 .card-cells-wrapper（已 px-16px + gap-12px），故卡片自身不再带外边距。
  &.normal {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 18px;
    background: var(--slax-surface);
    border: 1px solid var(--slax-border);
    border-radius: var(--slax-radius);
    box-shadow: inset 0 1px 0 var(--slax-inset-hi);
    transition: all 0.2s;

    &:hover {
      border-color: color-mix(in srgb, var(--slax-accent) 25%, transparent);
      box-shadow:
        0 2px 8px color-mix(in srgb, var(--slax-accent) 5%, transparent),
        inset 0 1px 0 var(--slax-inset-hi);
      transform: translateY(-1px);
    }

    .notification-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;

      .left {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;

        img {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        span {
          font-size: 13px;
          line-height: 1.4;
          color: var(--slax-text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;

          // 回复通知用强调色突出来源用户
          &.highlighted {
            color: var(--slax-accent);
            font-weight: 500;
          }
        }
      }

      .right {
        font-size: 12px;
        font-weight: 300;
        color: var(--slax-text-light);
        flex-shrink: 0;
      }
    }

    .notification-content {
      .comment .comment-text {
        font-size: 14px;
        line-height: 1.65;
        color: var(--slax-text);
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .reply {
        .reply-text {
          font-size: 14px;
          line-height: 1.65;
          color: var(--slax-text);
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }

        // 被引用的原评论：复用 highlight-quote 的「accent 左条 + accent 淡底」引用块样式
        .reply-comment {
          margin-top: 8px;
          padding: 7px 10px 7px 11px;
          border-left: 3px solid var(--slax-accent);
          background: var(--slax-accent-bg);
          border-radius: 0 4px 4px 0;

          span {
            display: block;
            font-size: 13px;
            line-height: 1.65;
            color: var(--slax-text-muted);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }
      }
    }

    .notification-footer {
      display: flex;
      align-items: center;
      gap: 8px;

      .link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: 12px;
        color: var(--slax-text-light);
        letter-spacing: 0.02em;

        svg {
          flex-shrink: 0;
          opacity: 0.7;
        }

        span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      button {
        margin-left: auto;
        flex-shrink: 0;
        padding: 0;
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        color: var(--slax-accent);
        transition: opacity var(--slax-dur-fast, 0.15s) ease;

        &:hover {
          opacity: 0.8;
        }
      }
    }
  }

  &.simple {
    --style: 'py-16px px-14px hover:(bg-surface)';
    .notification-header {
      --style: flex justify-between items-start;
      .left {
        --style: flex items-start;
        img {
          --style: w-24px h-24px rounded-full;
        }
        span {
          --style: ml-16px text-(aux txt-light) line-height-18px;

          &.highlighted {
            // #F6AF69 通知高亮橙（与 mark 高亮同源的强调色），保留
            --style: text-#F6AF69;
          }
        }
      }

      .right {
        --style: text-(aux txt-light) line-height-18px shrink-0;
      }
    }

    .notification-content {
      --style: mt-2px pl-40px;

      .comment {
        .comment-text {
          --style: text-(body txt) line-heigh-24px line-clamp-2;
        }

        .link {
          --style: mt-11px flex items-center;

          i {
            --style: w-16px h-16px bg-contain flex-shrink-0;
            background-image: url('@images/tiny-href-gray-icon.png');
          }

          span {
            --style: ml-4px text-(meta txt-light ellipsis) line-height-22px whitespace-nowrap overflow-hidden;
          }
        }
      }

      .reply {
        .reply-text {
          --style: text-(body txt) line-heigh-24px line-clamp-1;
        }

        .reply-comment {
          --style: pl-10px relative mt-9px flex;
          span {
            --style: ml-4px text-(meta txt-light ellipsis) line-height-22px whitespace-nowrap overflow-hidden;
          }

          &::after {
            // bg-#d6d6d6 引用左侧分隔短线（中性浅灰，与 token border 不同语义），保留
            --style: content-empty absolute left-0 top-1/2 w-2px h-21px bg-#d6d6d6 -translate-y-1/2;
          }
        }
      }
    }
  }
}
</style>
