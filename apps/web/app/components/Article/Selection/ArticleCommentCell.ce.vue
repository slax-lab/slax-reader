<template>
  <div class="article-comment-cell">
    <div class="group/comment">
      <div class="comment-header">
        <div class="left">
          <img :src="comment.isDeleted ? '' : comment.avatar" alt="" class="avatar" />
          <span class="username">{{ comment.isDeleted ? t('component.article_selection.user_deleted') : comment.username }}</span>
        </div>
        <div class="right">
          <div class="i-svg-spinners:180-ring-with-bg size-16px text-card text-txt-light" v-if="!comment.markUid || comment.loading"></div>
        </div>
      </div>
      <div class="comment-content">{{ comment.isDeleted ? t('component.article_selection.comment_deleted') : comment.comment }}</div>
      <div class="comment-footer">
        <span class="date">{{ showCreateTime(comment) }}</span>
        <div class="operates" v-if="comment.markUid && !comment.loading">
          <template v-if="!comment.operateLoading">
            <button class="reply group-hover/comment:!opacity-100" @click="replyComment(comment)"></button>
            <button
              class="bg-[url('@images/tiny-delete-red-outline-icon.png')] group-hover/comment:!opacity-100"
              v-if="canDeleteComment(comment)"
              @click="commentDeleteClick(comment)"
            ></button>
          </template>
          <div class="i-svg-spinners:180-ring-with-bg ml-10px text-body text-txt-light" v-else-if="comment.operateLoading"></div>
        </div>
      </div>
    </div>
    <div class="child-comments" v-if="commentChildren.length > 0">
      <!-- key 用稳定 markUid，避开异步 patch 崩溃 -->
      <div class="child-comment group/child" v-for="(childComment, childIndex) in commentChildren" :key="childComment.markUid || childIndex">
        <div class="child-comment-content">
          <span class="child-username">{{ childComment.username || '' }}</span>
          <span class="reply-text">&nbsp;{{ t('common.operate.reply') }}&nbsp;</span>
          <span class="parent-username">{{ childComment.reply?.username || '' }}: </span>
          <span class="comment-content-text">{{ childComment.comment }}</span>
          <div
            class="i-svg-spinners:180-ring-with-bg ml-5px inline-block h-14px w-14px translate-y-2px text-meta text-txt-light line-height-22px"
            v-if="!childComment.markUid || childComment.loading"
          ></div>
        </div>
        <div class="comment-footer">
          <span class="date">{{ showCreateTime(childComment) }}</span>
          <div class="operates" v-if="childComment.markUid && !childComment.loading">
            <template v-if="!childComment.operateLoading">
              <button class="reply-child group-hover/child:!opacity-100" @click="replyComment(childComment)"></button>
              <button
                class="bg-[url('@images/tiny-delete-red-outline-icon.png')] group-hover/child:!opacity-100"
                v-if="!childComment.isDeleted && canDeleteComment(childComment)"
                @click="commentDeleteClick(childComment)"
              ></button>
            </template>
            <div class="i-svg-spinners:180-ring-with-bg text-body text-txt-light" v-else-if="childComment.operateLoading"></div>
          </div>
        </div>
        <ArticleCommentInput :show-input="childComment.showInput" :placeholder="getCommentPlaceholder(childComment)" @post="text => postComment(childComment, text)" />
      </div>
    </div>
    <ArticleCommentInput :show-input="comment.showInput" :placeholder="getCommentPlaceholder(comment)" @post="text => postComment(comment, text)" />
  </div>
</template>

<script setup lang="ts">
import ArticleCommentInput from './ArticleCommentInput.ce.vue'

import { formatDate } from '@commons/frontend-utils/date'

import type { MarkCommentInfo } from './type'
import { showLoginModal } from '~/components/Modal'
import { useUserStore } from '~/stores/user'
import type { PropType } from 'vue'

const emits = defineEmits(['replyComment', 'commentDelete'])

const props = defineProps({
  comment: {
    type: Object as PropType<MarkCommentInfo>,
    required: true
  },
  bookmarkUserId: {
    type: Number,
    required: true
  }
})

const commentChildren = computed(() => {
  return props.comment.children.filter(child => !child.isDeleted)
})

const t = (text: string, opts: Record<string, string> = {}) => {
  return useNuxtApp().$i18n.t(text, opts)
}

const showCreateTime = (comment: MarkCommentInfo) => {
  const now = new Date()
  const diff = (now.getTime() - comment.createdAt.getTime()) / 1000
  const minutes = Math.floor(diff / 60)
  const hours = Math.floor(diff / 3600)
  if (diff < 60) {
    return t('component.article_selection.just_now')
  } else if (diff < 3600) {
    return `${minutes} ${t(`component.article_selection.minutes_ago`)}`
  } else if (diff < 86400) {
    return `${hours} ${t(`component.article_selection.hours_ago`)}`
  } else {
    return formatDate(comment.createdAt, 'YY-MM-DD HH:mm')
  }
}

const canDeleteComment = (comment: MarkCommentInfo) => {
  const userId = useUserStore().userInfo?.userId
  return (userId === comment.userId || userId === props.bookmarkUserId) && !comment.isDeleted
}

const replyComment = (comment: MarkCommentInfo) => {
  if (comment.isDeleted) return
  if (!useUserStore().userInfo) {
    return showLoginModal({
      redirect: window.location.href
    })
  }

  comment.showInput = !comment.showInput
}

const getCommentPlaceholder = (comment: MarkCommentInfo) => {
  return t(`component.article_selection.comment_placeholder`, { username: comment.username })
}

const commentDeleteClick = (comment: MarkCommentInfo) => {
  comment.operateLoading = true
  emits('commentDelete', comment)
}

const postComment = (comment: MarkCommentInfo, replyComment: string) => {
  emits('replyComment', {
    replyToUid: comment.markUid,
    comment: replyComment
  })

  comment.showInput = false
}
</script>

<style lang="scss" scoped>
@use '~~/styles/global.scss' as *;

// 本组件消费的 token（无 dark prop，全靠宿主 data-slax-theme 切换）：
//   --slax-surface-solid, --slax-text, --slax-text-light, --slax-border
// 其余 (#99999933 蓝灰半透明分隔线) 保留。
//
// reply / reply-child 资源切图（双 PNG）：
//   shadow DOM 不能匹配 [data-slax-theme] / :host-context()，故 light/dark 切图依赖
//   父级 ArticleSelectionPanel 的 dark prop（在其 scoped 内 `.dark` 容器 cascade 至此）。

.article-comment-cell {
  --style: 'px-16px pt-16px pb-20px rounded-8px not-first:mt-8px bg-surface-solid';

  .comment-header {
    --style: flex justify-between items-center;

    .left {
      --style: select-none flex items-center;
      img {
        --style: w-24px h-24px rounded-full;
      }

      span {
        --style: ml-8px text-(aux) line-height-18px text-txt-light;
      }
    }

    .right {
      --style: flex items-center;
    }
  }

  .comment-header + .comment-content {
    --style: mt-12px;
  }

  .comment-content {
    --style: text-(body) line-height-24px whitespace-pre-line text-txt;
  }

  .comment-footer {
    --style: mt-4px flex items-center justify-between;

    .date {
      --style: text-(aux) line-height-18px select-none text-txt-light;
    }

    .operates {
      --style: flex-center;
      button {
        --style: 'w-16px h-16px opacity-0 bg-contain not-first:(ml-10px) hover:(scale-105) active:(scale-110) transition-all duration-normal';
      }

      .reply,
      .reply-child {
        background-image: url('@images/tiny-comment-icon.png');
      }
    }
  }

  .child-comments {
    // #99999933 蓝灰半透明左竖线，与 token border 调性不完全一致，保留
    --style: mt-16px pl-12px border-l-(2px solid #99999933);

    .child-comment {
      --style: 'not-first:(mt-13px) text-meta line-height-20px';

      .child-comment-content {
        --style: text-(meta) line-height-22px whitespace-pre-line;

        .child-username,
        .parent-username {
          --style: select-none text-txt-light;
        }

        .reply-text {
          --style: select-none text-txt;
        }

        .comment-content-text {
          --style: text-txt;
        }
      }
    }
  }

  // eslint-disable-next-line vue-scoped-css/no-unused-selector
  .article-comment-input {
    --style: mt-16px;
  }
}
</style>
