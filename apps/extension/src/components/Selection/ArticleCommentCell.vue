<template>
  <div class="article-comment-cell" :class="{ 'animate-pulse': highlighting, 'animate-duration-500': highlighting, 'semi-transparent': comment.noMarkMapping }" ref="cell">
    <div class="group/comment">
      <div class="comment-header">
        <div class="left">
          <img :src="comment.isDeleted ? '' : comment.avatar" alt="" class="avatar" />
          <span class="username">{{ comment.isDeleted ? 'Deleted' : comment.username }}</span>
        </div>
        <div class="right">
          <div class="i-svg-spinners:180-ring-with-bg text-18px text-#999" v-if="!comment.markUid || comment.loading"></div>
        </div>
      </div>
      <div class="comment-content">{{ comment.isDeleted ? $t('component.article_selection.comment_deleted') : comment.comment }}</div>
      <div class="comment-footer">
        <span class="date">{{ showCreateTime(comment) }}</span>
        <div class="operates" v-if="comment.markUid && !comment.loading">
          <template v-if="!comment.operateLoading">
            <button class="reply-btn group-hover/comment:!opacity-100" @click.stop="replyComment(comment)"></button>
            <button class="delete-btn group-hover/comment:!opacity-100" v-if="canDeleteComment(comment)" @click.stop="commentDeleteClick(comment)"></button>
          </template>
          <div class="i-svg-spinners:180-ring-with-bg ml-10px text-16px text-#999" v-else-if="comment.operateLoading"></div>
        </div>
      </div>
    </div>
    <div class="child-comments" v-if="commentChildren.length > 0">
      <TransitionGroup name="opacity">
        <div class="child-comment group/child" v-for="(childComment, childIndex) in commentChildren" :key="childIndex">
          <div class="child-comment-content">
            <span class="child-username">{{ childComment.username || '' }}</span>
            <span class="reply-text">&nbsp;{{ $t('common.operate.reply') }}&nbsp;</span>
            <span class="parent-username">{{ childComment.reply?.username || '' }}: </span>
            <span class="comment-content-text">{{ childComment.comment }}</span>
            <div
              class="i-svg-spinners:180-ring-with-bg ml-5px inline-block h-14px w-14px translate-y-2px text-14px text-#999 line-height-22px"
              v-if="!childComment.markUid || childComment.loading"
            ></div>
          </div>
          <div class="comment-footer">
            <span class="date">{{ showCreateTime(comment) }}</span>
            <div class="operates" v-if="childComment.markUid && !childComment.loading">
              <template v-if="!childComment.operateLoading">
                <button class="reply-btn group-hover/child:!opacity-100" @click.stop="replyComment(childComment)"></button>
                <button
                  class="delete-btn group-hover/child:!opacity-100"
                  v-if="!childComment.isDeleted && canDeleteComment(childComment)"
                  @click.stop="commentDeleteClick(childComment)"
                ></button>
              </template>
              <div class="i-svg-spinners:180-ring-with-bg text-16px text-#999" v-else-if="childComment.operateLoading"></div>
            </div>
          </div>
          <ArticleCommentInput :show-input="childComment.showInput" :placeholder="getCommentPlaceholder(childComment)" @post="text => postComment(childComment, text)" />
        </div>
      </TransitionGroup>
    </div>
    <ArticleCommentInput :show-input="comment.showInput" :placeholder="getCommentPlaceholder(comment)" @post="text => postComment(comment, text)" />
  </div>
</template>

<script setup lang="ts">
import ArticleCommentInput from './ArticleCommentInput.vue'

import { formatDate } from '@commons/utils/date'

import type { MarkCommentInfo } from './type'
import type { PropType } from 'vue'

const emits = defineEmits(['replyComment', 'commentDelete'])

const props = defineProps({
  comment: {
    type: Object as PropType<MarkCommentInfo>,
    required: true
  },
  userId: {
    type: Number,
    required: true
  }
})

const cell = ref<HTMLElement>()
const highlighting = ref(false)

const commentChildren = computed(() => {
  return props.comment.children.filter(child => !child.isDeleted)
})

const showCreateTime = (comment: MarkCommentInfo) => {
  const now = new Date()
  const diff = (now.getTime() - comment.createdAt.getTime()) / 1000
  const minutes = Math.floor(diff / 60)
  const hours = Math.floor(diff / 3600)
  if (diff < 60) {
    return $t('component.article_selection.just_now')
  } else if (diff < 3600) {
    return `${minutes} ${$t(`component.article_selection.minutes_ago`)}`
  } else if (diff < 86400) {
    return `${hours} ${$t(`component.article_selection.hours_ago`)}`
  } else {
    return formatDate(comment.createdAt, 'YY-MM-DD HH:mm')
  }
}

const canDeleteComment = (comment: MarkCommentInfo) => {
  return props.userId === comment.userId && !comment.isDeleted
}

const replyComment = (comment: MarkCommentInfo) => {
  if (comment.isDeleted) return
  comment.showInput = !comment.showInput
}

const getCommentPlaceholder = (comment: MarkCommentInfo) => {
  return $t(`component.article_selection.comment_placeholder`, [comment.username])
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

const highlightCell = () => {
  cell.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setTimeout(() => {
    highlighting.value = true

    setTimeout(() => {
      highlighting.value = false
    }, 1000)
  }, 400)
}

defineExpose({
  highlightCell
})
</script>

<style lang="scss" scoped>
.article-comment-cell {
  --style: 'px-16px pt-16px pb-20px rounded-8px bg-#333333FF not-first:mt-8px';

  &.semi-transparent {
    --style: opacity-50;
  }

  .comment-header {
    --style: flex justify-between items-center;

    .left {
      --style: select-none flex items-center;
      img {
        --style: w-24px h-24px rounded-full;
      }

      span {
        --style: ml-8px text-(13px #ffffff66) line-height-18px;
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
    --style: text-(16px #ffffffcc) line-height-24px whitespace-pre-line break-words;
  }

  .comment-footer {
    --style: mt-4px flex items-center justify-between;

    .date {
      --style: text-(13px #999999ff) line-height-18px select-none;
    }

    .operates {
      --style: flex-center;
      button {
        --style: 'w-16px h-16px opacity-0 bg-contain not-first:(ml-10px) hover:(scale-105) active:(scale-110) transition-all duration-250';
      }

      .reply-btn {
        background-image: url('@/assets/tiny-comment-icon.png');
      }

      .delete-btn {
        background-image: url('@/assets/tiny-delete-red-outline-icon.png');
      }
    }
  }

  .child-comments {
    --style: mt-16px pl-12px border-l-(2px solid #99999933);

    .child-comment {
      --style: 'not-first:(mt-13px) text-14px line-height-20px';

      .child-comment-content {
        --style: text-(14px) line-height-22px whitespace-pre-line;

        .child-username,
        .parent-username {
          --style: text-#FFFFFF66 select-none;
        }

        .reply-text {
          --style: text-#FFFFFFCC select-none;
        }

        .comment-content-text {
          --style: text-#FFFFFFCC;
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
