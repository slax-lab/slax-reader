<template>
  <article
    class="comment-item"
    :class="{ 'is-active': isActive, 'comment-item-article': !hasSource }"
    :data-comment-info-id="infoId"
    @click="$emit('card-click', infoId)"
    @mouseleave="resetConfirm"
  >
    <!-- 主评论（取 comments[0]） -->
    <template v-if="mainComment">
      <!-- 引用块 -->
      <blockquote v-if="hasSource" class="comment-quote">{{ quoteText }}</blockquote>
      <span v-else class="comment-scope-badge">{{ $t('page.bookmarks_detail.comment_all') }}</span>

      <!-- 评论正文 -->
      <p v-if="mainComment.isDeleted || mainComment.comment" class="comment-reply">
        {{ mainComment.isDeleted ? $t('component.article_selection.comment_deleted') : mainComment.comment }}
      </p>

      <div class="comment-meta">
        <span>
          <span class="comment-author">{{ mainComment.isDeleted ? $t('component.article_selection.user_deleted') : mainComment.username }}</span>
          <template v-if="mainComment.createdAt"> · {{ formatYmd(mainComment.createdAt) }}</template>
        </span>
        <span v-if="(allowAction || allowReply) && !mainComment.isDeleted" class="comment-meta-actions">
          <!-- 划线则取消划线，纯评论则删评论 -->
          <button
            v-if="allowAction && (canUnhighlight || canDeleteComment)"
            class="comment-delete-trigger"
            :class="{ 'is-confirming': confirmingDelete }"
            @click.stop="onDeleteClick"
          >
            {{ confirmingDelete ? $t('common.operate.confirm_delete') : $t('common.operate.delete') }}
          </button>
          <span v-if="allowAction && (canUnhighlight || canDeleteComment)" class="comment-meta-divider" aria-hidden="true"></span>
          <button v-if="allowAction || allowReply" class="comment-reply-trigger" @click.stop="$emit('reply', mainComment)">
            {{ $t('common.operate.reply') }}
          </button>
        </span>
      </div>

      <!-- 子评论（点击同样跳转正文） -->
      <div v-if="visibleChildren.length" class="comment-sub-list">
        <div v-for="child in visibleChildren" :key="child.markUid" class="comment-sub">
          <p class="comment-sub-text">
            <span v-if="child.reply?.username" class="comment-sub-reply-to">{{ `@${child.reply.username} ` }}</span
            >{{ child.comment }}
          </p>
          <div class="comment-sub-time">
            <span>
              <span class="comment-author">{{ child.username }}</span>
              <template v-if="child.createdAt"> · {{ formatYmd(child.createdAt) }}</template>
            </span>
            <span v-if="allowAction || allowReply || canDeleteChild(child)" class="comment-sub-actions">
              <button
                v-if="canDeleteChild(child)"
                class="comment-sub-delete-btn"
                :class="{ 'is-confirming': confirmingChildUid === child.markUid }"
                @click.stop="onDeleteChildClick(child)"
              >
                {{ confirmingChildUid === child.markUid ? $t('common.operate.confirm_delete') : $t('common.operate.delete') }}
              </button>
              <button v-if="(allowAction || allowReply) && child.markUid && !child.isDeleted" class="comment-sub-reply-btn" @click.stop="$emit('reply', child)">
                {{ $t('common.operate.reply') }}
              </button>
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- 仅有引用无评论（纯划线） -->
    <template v-else>
      <blockquote v-if="hasSource" class="comment-quote">{{ quoteText }}</blockquote>
      <span v-else class="comment-scope-badge">{{ $t('page.bookmarks_detail.comment_all') }}</span>
      <div class="comment-meta">
        <span v-if="strokeUser">
          <span class="comment-author">{{ strokeUser.username }}</span>
          <template v-if="strokeUser.createdAt"> · {{ formatYmd(strokeUser.createdAt) }}</template>
        </span>
        <span v-if="allowAction" class="comment-meta-actions">
          <!-- 自己的划线才显示 -->
          <button v-if="canUnhighlight" class="comment-delete-trigger" :class="{ 'is-confirming': confirmingDelete }" @click.stop="onDeleteClick">
            {{ confirmingDelete ? $t('common.operate.confirm_delete') : $t('common.operate.delete') }}
          </button>
          <span v-if="canUnhighlight" class="comment-meta-divider" aria-hidden="true"></span>
          <button class="comment-reply-trigger" @click.stop="$emit('reply-stroke')">
            {{ $t('common.operate.reply') }}
          </button>
        </span>
      </div>
    </template>
  </article>
</template>

<script lang="ts" setup>
import { formatDate } from '@commons/frontend-utils/date'

import type { MarkCommentInfo, MarkItemInfo } from '@slax-reader/selection/types'

const props = defineProps<{
  infoId: string
  source: MarkItemInfo['source']
  comments: MarkCommentInfo[]
  isActive?: boolean
  allowAction?: boolean
  allowReply?: boolean
  allowDeleteOwnReply?: boolean
  // 本人划线：删除=取消划线留评论
  canUnhighlight?: boolean
  // 本人纯评论：删除评论
  canDeleteComment?: boolean
  quoteText?: string
  strokeUser?: { username: string; avatar?: string; createdAt?: Date | string }
  // 判定子评论归属，决定是否可删
  currentUserId?: number | string | null
}>()

const emit = defineEmits<{
  'card-click': [infoId: string]
  reply: [comment: MarkCommentInfo]
  'reply-stroke': []
  'cancel-highlight': []
  'delete-comment': [comment: MarkCommentInfo]
}>()

const hasSource = computed(() => props.source.length > 0)
const mainComment = computed(() => props.comments[0] ?? null)
// 已删除子评论不展示
const visibleChildren = computed(() => mainComment.value?.children?.filter(c => !c.isDeleted) ?? [])

// 删除二次确认：首次点击切到确认态，
// 再次点击才真正删除
const confirmingDelete = ref(false)
// 正在确认删除的子评论 markUid
const confirmingChildUid = ref<string | null>(null)
let confirmTimer: ReturnType<typeof setTimeout> | null = null

const resetConfirm = () => {
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmTimer = null
  confirmingDelete.value = false
  confirmingChildUid.value = null
}

const onDeleteClick = () => {
  if (!confirmingDelete.value) {
    resetConfirm()
    confirmingDelete.value = true
    // 3 秒未确认自动复位
    confirmTimer = setTimeout(resetConfirm, 3000)
    return
  }
  resetConfirm()
  if (props.canUnhighlight) emit('cancel-highlight')
  else if (mainComment.value) emit('delete-comment', mainComment.value)
}

// 本人子评论才可删
const canDeleteChild = (child: MarkCommentInfo) =>
  !child.isDeleted && (!!props.allowAction || !!props.allowDeleteOwnReply) && !!child.markUid && props.currentUserId != null && child.userId === props.currentUserId

const onDeleteChildClick = (child: MarkCommentInfo) => {
  if (confirmingChildUid.value !== child.markUid) {
    resetConfirm()
    confirmingChildUid.value = child.markUid ?? null
    confirmTimer = setTimeout(resetConfirm, 3000)
    return
  }
  resetConfirm()
  emit('delete-comment', child)
}

const formatYmd = (date: Date | string | undefined) => {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  return formatDate(d, 'YYYY-MM-DD')
}
</script>

<style lang="scss" scoped>
@keyframes comment-flash {
  0% {
    background: var(--slax-accent-bg);
    border-color: var(--slax-accent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--slax-accent) 12%, transparent);
  }
  100% {
    background: var(--slax-surface);
    border-color: var(--slax-border);
    box-shadow: none;
  }
}

.comment-item {
  padding: 12px 14px;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: color-mix(in srgb, var(--slax-accent) 25%, transparent);
    box-shadow:
      0 2px 8px color-mix(in srgb, var(--slax-accent) 5%, transparent),
      inset 0 1px 0 var(--slax-inset-hi);
    transform: translateY(-1px);
  }

  &.comment-item-article {
    cursor: default;

    &:hover {
      transform: none;
    }

    .comment-reply {
      margin-top: 0;
    }
  }

  &.is-active {
    animation: comment-flash 5s cubic-bezier(0.16, 1, 0.3, 1);
  }

  &:hover .comment-meta .comment-meta-actions {
    opacity: 1;
  }

  .comment-scope-badge {
    font-size: 12px;
    padding: 1px 8px;
    background: var(--slax-accent-bg);
    color: var(--slax-accent);
    border-radius: 10px;
    font-weight: 400;
    letter-spacing: 0.02em;
    display: inline-block;
    margin-bottom: 8px;
  }

  .comment-quote {
    margin: 0;
    padding: 7px 10px 7px 11px;
    border-left: 3px solid var(--slax-accent);
    background: var(--slax-accent-bg);
    border-radius: 0 4px 4px 0;
    // 对齐 demo .comment-quote：13px / line-height 1.8
    font-size: 13px;
    line-height: 1.8;
    color: var(--slax-text-muted);
  }

  .comment-reply {
    margin: 10px 0 0;
    // 对齐 demo .comment-reply：14px / line-height 1.65
    font-size: 14px;
    line-height: 1.65;
    color: var(--slax-text);
  }

  .comment-meta {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    margin-top: 10px;
    font-size: 12px;
    color: var(--slax-text-light);
    font-weight: 300;

    .comment-author {
      color: var(--slax-text-muted);
      font-weight: 500;
    }

    .comment-meta-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      // 默认隐藏，hover 单元格才显示
      opacity: 0;
      transition: opacity 0.15s;

      // 触屏无 hover，始终显示
      @media (hover: none) {
        opacity: 1;
      }
    }

    .comment-meta-divider {
      width: 1px;
      height: 12px;
      background: var(--slax-border);
    }

    .comment-reply-trigger,
    .comment-delete-trigger {
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      font-size: 12px;
      color: var(--slax-accent);
      cursor: pointer;
      opacity: 0.75;
      transition: opacity 0.15s;

      &:hover {
        opacity: 1;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
    }

    // 删除用中性色
    .comment-delete-trigger {
      color: var(--slax-text-light);

      // 确认态：醒目警示色 + 始终下划线
      &.is-confirming {
        color: #e5484d;
        opacity: 1;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
    }
  }

  .comment-sub-list {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed var(--slax-border);
    display: flex;
    flex-direction: column;
    gap: 12px;

    .comment-sub {
      padding-left: 10px;
      border-left: 2px solid var(--slax-accent-bg);

      .comment-sub-text {
        font-size: 13px;
        line-height: 1.6;
        color: var(--slax-text);
        margin: 0 0 4px;
        white-space: pre-wrap;
        word-break: break-word;

        .comment-sub-reply-to {
          color: var(--slax-accent);
          font-weight: 500;
        }
      }

      .comment-sub-time {
        font-size: 12px;
        color: var(--slax-text-light);
        font-weight: 300;
        display: flex;
        align-items: center;
        justify-content: space-between;

        .comment-author {
          color: var(--slax-text-muted);
          font-weight: 500;
        }

        .comment-sub-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-left: 4px;
        }

        .comment-sub-reply-btn,
        .comment-sub-delete-btn {
          background: none;
          border: none;
          padding: 0;
          font: inherit;
          font-size: 12px;
          color: var(--slax-accent);
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.15s;

          &:hover {
            text-decoration: underline;
            text-underline-offset: 3px;
          }
        }

        // 删除用中性色，确认态转警示
        .comment-sub-delete-btn {
          color: var(--slax-text-light);

          &.is-confirming {
            color: #e5484d;
            opacity: 1;
            text-decoration: underline;
            text-underline-offset: 3px;
          }
        }
      }

      &:hover .comment-sub-reply-btn,
      &:hover .comment-sub-delete-btn {
        opacity: 0.75;
      }
    }
  }
}
</style>
