<template>
  <div class="comment-list-panel">
    <div class="comment-list-header">
      <span class="comment-title">{{ $t('page.bookmarks_detail.comments') }}</span>
      <span v-if="totalCount > 0" class="comment-badge">{{ totalCount }}</span>
    </div>

    <!-- 空态：引导去正文划选后划线/评论 -->
    <div v-if="displayCards.length === 0" class="comment-empty">
      <div class="comment-empty-icon">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </div>
      <div class="comment-empty-desc">{{ $t('component.snapshot_comment.empty_desc') }}</div>
    </div>

    <div v-else class="comment-cards">
      <SnapshotCommentCard
        v-for="card in displayCards"
        :key="card.key"
        :info-id="card.infoId"
        :source="card.source"
        :comments="card.comments"
        :stroke-user="card.strokeUser"
        :is-active="activeInfoId === card.infoId"
        :allow-action="allowAction"
        :allow-reply="allowReply"
        :allow-delete-own-reply="allowDeleteOwnReply"
        :can-unhighlight="card.canUnhighlight"
        :can-delete-comment="card.canDeleteComment"
        :current-user-id="currentUserId"
        :quote-text="card.quoteText"
        @card-click="$emit('card-click', $event)"
        @reply="$emit('reply', $event)"
        @reply-stroke="$emit('reply-stroke', card.infoId)"
        @cancel-highlight="$emit('cancel-highlight', card.infoId)"
        @delete-comment="$emit('delete-comment', card.infoId, $event)"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import SnapshotCommentCard from './SnapshotCommentCard.vue'

import type { UserList } from '@commons/types/interface'
import type { MarkCommentInfo, MarkItemInfo, MarkPathItem } from '@slax-reader/selection/types'
import { useUserStore } from '~/stores/user'

const props = defineProps<{
  infos: MarkItemInfo[]
  activeInfoId: string | null
  allowAction?: boolean
  allowReply?: boolean
  allowDeleteOwnReply?: boolean
  // 页面级开关：是否允许取消划线
  allowUnhighlight?: boolean
  userList?: UserList
}>()

defineEmits<{
  'card-click': [infoId: string]
  reply: [comment: MarkCommentInfo]
  'reply-stroke': [infoId: string]
  'cancel-highlight': [infoId: string]
  'delete-comment': [infoId: string, comment: MarkCommentInfo]
}>()

const currentUserId = computed(() => useUserStore().userInfo?.userId ?? null)

interface DisplayCard {
  // 稳定 key（不含数组下标），
  // 删卡时复用 DOM 避免 hover 闪烁
  key: string
  infoId: string
  source: MarkPathItem[]
  comments: MarkCommentInfo[]
  strokeUser: { username: string; avatar?: string; createdAt?: Date | string } | undefined
  quoteText: string
  canUnhighlight: boolean
  canDeleteComment: boolean
}

const totalCount = computed(() => {
  return props.infos.reduce((acc, info) => {
    // 已删除评论不计数
    const countComments = (comments: MarkCommentInfo[]): number => comments.reduce((sum, c) => sum + (c.isDeleted ? 0 : 1) + countComments(c.children ?? []), 0)
    const commentCount = countComments(info.comments)
    // 无有效评论但有划线时，纯划线计为 1
    if (commentCount === 0 && info.stroke.length > 0) return acc + 1
    return acc + commentCount
  }, 0)
})

const getStrokeUser = (info: MarkItemInfo) => {
  if (!props.userList || !info.stroke.length) return undefined
  const stroke = info.stroke[0]
  const userId = stroke?.userId
  if (!userId) return undefined
  const user = props.userList[String(userId)]
  if (!user) return undefined
  return { username: user.username, avatar: user.avatar, createdAt: stroke?.createdAt }
}

const getQuoteText = (info: MarkItemInfo): string => {
  if (!info.source.length) return ''
  const hasImage = info.source.some(s => s.type === 'image')

  // 纯文本划线优先用 approx.exact（服务端存储的精确文本，不依赖 DOM）
  if (!hasImage && info.approx?.exact) return info.approx.exact

  // 含图片时按原始顺序逐项拼接，图片以 emoji 占位（对齐 Chat 侧的引用展示）
  try {
    return info.source
      .map(item => {
        if (item.type === 'image') return '🖼️'
        const el = document.querySelector(item.path)
        if (!el) return ''
        const text = el.textContent || ''
        return text.slice(item.start ?? 0, item.end ?? text.length)
      })
      .join('')
  } catch {
    return hasImage ? '🖼️' : ''
  }
}

// 将每个 MarkItemInfo 按评论展开：
// - 有 N 条评论 → N 张卡片（划线数据并入每张卡片，不单独展示）
// - 纯划线（无评论）→ 1 张卡片
const displayCards = computed((): DisplayCard[] => {
  const cards: DisplayCard[] = []
  const uid = currentUserId.value
  for (const info of props.infos) {
    const strokeUser = getStrokeUser(info)
    const quoteText = getQuoteText(info)
    // 有自己的划线且页面允许才显示
    const canUnhighlight = !!props.allowUnhighlight && !!uid && info.stroke.some(s => s.userId === uid)
    // 已删除评论不展示
    const liveComments = info.comments.filter(c => !c.isDeleted || c.children.some(child => !child.isDeleted))
    if (liveComments.length > 0) {
      for (const comment of liveComments) {
        // 本人纯评论才显示删除
        const canDeleteComment = !canUnhighlight && !!uid && comment.userId === uid
        // markUid 唯一稳定；未落库时退回 info.id
        const key = `c:${comment.markUid || info.id}`
        cards.push({ key, infoId: info.id, source: info.source, comments: [comment], strokeUser, quoteText, canUnhighlight, canDeleteComment })
      }
    } else if (info.stroke.length > 0) {
      // 评论全删且无划线时整条不展示，
      // 避免残留空引用卡
      cards.push({ key: `s:${info.id}`, infoId: info.id, source: info.source, comments: [], strokeUser, quoteText, canUnhighlight, canDeleteComment: false })
    }
  }
  return cards
})
</script>

<style lang="scss" scoped>
.comment-list-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.comment-list-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 24px 24px 0;
  margin-bottom: 12px;
}

.comment-title {
  font-family: var(--slax-font-serif);
  font-size: 18px;
  font-weight: 500;
  color: var(--slax-text);
  line-height: 1.4;
}

// 对齐 demo 的 .panel-title-count：accent 淡底 + accent 文字的软标签，而非实心彩底白字
.comment-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.02em;
  background: var(--slax-accent-bg);
  color: var(--slax-accent);
}

// 空态引导，对齐 Chat 的 .chat-empty
.comment-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px 8px 68px;
  color: var(--slax-text-light);

  .comment-empty-icon {
    width: 36px;
    height: 36px;
    margin: 0 auto 12px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--slax-accent-bg);
    color: var(--slax-accent);
  }

  .comment-empty-title {
    font-size: 13px;
    color: var(--slax-text-muted);
    line-height: 1.6;
  }

  .comment-empty-desc {
    font-size: 13px;
    color: var(--slax-text-muted);
    line-height: 1.6;
    white-space: pre-line;
  }
}

.comment-cards {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
