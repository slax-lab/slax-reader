<template>
  <div class="bookmark-article snapshot" ref="bookmarkArticle" :class="{ [articleStyle]: true }">
    <header class="article-header">
      <SnapshotArticleSource
        v-if="detail.target_url"
        :url="detail.target_url"
        :site-name="detail.site_name"
        :column-name="(detail as BookmarkArticleDetail & { column_name?: string }).column_name"
        :author="detail.byline"
        :host-url="detail.host_url"
      />
      <div class="article-divider" />
      <h1 class="article-title" :title="title">{{ title }}</h1>
      <BookmarkTags
        v-if="effAllowTagged"
        class="article-tags"
        :bookmarkId="bookmarkId || 0"
        :bookmarkUid="bookmarkUid"
        :bookmarkUuid="adapters.tagsBookmarkUuid"
        :tags="detail.tags ?? []"
        :readonly="!ready || !effAllowTagged"
      />
    </header>
    <!-- 保留 .article-detail ref + articleStyle class，processors 管道 / mark 绘制依赖 -->
    <div class="article-detail article-body" ref="articleDetail" :class="{ [articleStyle]: true }">
      <div class="html-text" lang="en" v-html="articleHTML"></div>
    </div>
    <SnapshotArticleFooter :via="footerVia" :show-via="footerShowVia" :collection="footerCollection" />
  </div>
</template>

<script lang="ts" setup>
import BookmarkTags from '~/components/BookmarkTags.vue'
import SnapshotArticleFooter from '~/components/Snapshot/SnapshotArticleFooter.vue'
import SnapshotArticleSource from '~/components/Snapshot/SnapshotArticleSource.vue'

import 'katex/dist/katex.css'
import { registerComponents } from './CEComponents'
import { ArticleStyle } from './processors'
import { ArticleSelectionAdaptersKey } from './Selection/injection'
import type { MarkDetail } from '@commons/frontend-types/models'
import type { QuoteData } from '~/components/Chat/type'
import CursorToast from '~/components/CursorToast'
import Toast, { ToastType } from '~/components/Toast'
import { useArticleDetail } from '~/composables/bookmark/useArticle'
import { useArticleSelection } from '~/composables/bookmark/useArticleSelection'

const props = defineProps({
  detail: {
    type: Object as PropType<BookmarkArticleDetail>,
    required: true
  },
  marks: {
    type: Object as PropType<MarkDetail>,
    required: false
  },
  // footer "Shared via X" 署名：留空回退 Slax Reader，/b/[id] 传入 owner 昵称
  footerVia: {
    type: String,
    required: false,
    default: ''
  },
  // footer 左侧署名段是否展示；owner 访问自己的快照时传 false 隐藏
  footerShowVia: {
    type: Boolean,
    required: false,
    default: true
  },
  // footer 合集归属入口
  footerCollection: {
    type: Object as PropType<{ name: string; code: string } | null>,
    required: false,
    default: null
  },
  // 门控渲染与绘制，默认 true
  // LF 传 localReady
  ready: {
    type: Boolean,
    required: false,
    default: true
  }
})

const emits = defineEmits(['screenLockUpdate', 'bookmarkUpdate', 'chatBotQuote'])

// 行为注入，默认空=现状
const adapters = inject(ArticleSelectionAdaptersKey, {})

const { t } = useI18n()
const { detail } = toRefs(props)
const bookmarkArticle = ref<HTMLDivElement>()
const articleDetail = ref<HTMLDivElement>()

// 仅调用一次，模板与 composable 共用
const { bookmarkId, shareCode, bookmarkUid, title, allowTagged, allowAction, bookmarkUserId, updateStarred } = useArticleDetail(detail)

// inject 可覆盖，回退 allowTagged
const effAllowTagged = computed(() => adapters.allowActionOverride ?? allowTagged.value)

const articleStyle = computed(() => {
  const content = (props.detail.content || '').trimStart()
  if (content.indexOf('<slax-photo-swipe-topic>') === 0) {
    return ArticleStyle.PhotoSwipeTopic
  } else if (content.indexOf('<div class=\"tweet\">') === 0) {
    return ArticleStyle.Twitter
  } else if (/^<div\b[^>]*\bclass="[^"]*\bsocial-post\b/.test(content)) {
    // 宽松匹配 class 含 social-post，
    // 避免加 class/属性时误落 Default
    return ArticleStyle.SocialPost
  }

  return ArticleStyle.Default
})

const articleHTML = computed(() => {
  return detail.value.content?.replace(/<img/g, '<img loading="lazy"') || ''
})

// 划线/评论重逻辑唯一来源
const { articleSelectionRef, handleHTML, findQuote, cleanup } = useArticleSelection({
  detail,
  containerDom: bookmarkArticle,
  monitorDom: articleDetail,
  marks: toRef(props, 'marks'),
  ready: toRef(props, 'ready'),
  articleStyle,
  adapters,
  onChatBotQuote: (data: QuoteData) => emits('chatBotQuote', data),
  onScreenLockUpdate: (locked: boolean) => emits('screenLockUpdate', locked),
  bookmarkId,
  shareCode,
  bookmarkUid,
  allowAction,
  bookmarkUserId
})

// 只调 handleHTML，置 htmlReady
// draw 由 composable watch 触发
onMounted(() => {
  registerComponents()

  nextTick(() => {
    handleHTML()
  })
})

onUnmounted(cleanup)

const starBookmark = async (event: MouseEvent, isStar: boolean) => {
  if (!bookmarkId || !updateStarred.value) {
    return
  }

  try {
    await updateStarred.value(isStar)

    postChannelMessage('star', { id: bookmarkId, cancel: !isStar })

    CursorToast.showToast({
      text: t(!isStar ? 'common.tips.unstar_success' : 'common.tips.star_success'),
      trackDom: event.target as HTMLElement
    })

    emits('bookmarkUpdate', detail.value)
  } catch (e) {
    console.log(e)
    Toast.showToast({
      text: t('common.tips.operate_failed'),
      type: ToastType.Error
    })
  }
}

defineExpose({
  findQuote,
  articleSelection: articleSelectionRef
})
</script>

<style lang="scss" scoped>
.bookmark-article.snapshot {
  --style: relative;
  // 正文容器宽度与 padding（snapshot §2.2）
  // padding-top: 76px 是从页面顶部算的，已有 52px header padding，故此处只需 24px
  width: var(--slax-content-w);
  max-width: 100%;
  padding: 24px 24px 0;

  @media (max-width: 768px) {
    // H5: 64px - 48px header = 16px
    padding: 16px 16px 0;
  }

  // 清零旧 DetailLayout .detail-container mt-32px 叠加
  :deep(.detail-container) {
    margin-top: 0;
  }
}

.article-header {
  display: flex;
  flex-direction: column;
}

.article-divider {
  height: 1px;
  background: var(--slax-border);
  margin: 20px 0 24px;
}

.article-title {
  // 最多三行，超出省略号
  // 完整标题由 title 悬浮展示
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-display);
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: -0.02em;
  color: var(--slax-text);
  margin: 0 0 20px;
  border-radius: 4px;
  outline: none;
  transition: box-shadow 0.15s;

  &[contenteditable='true'] {
    // 编辑态解除截断
    display: block;
    -webkit-line-clamp: unset;
    line-clamp: unset;
    overflow: visible;
    box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--slax-accent) 50%, transparent);
    padding: 2px 6px;
    margin-left: -6px;
    cursor: text;
  }
}

.article-tags {
  margin-top: 20px;
  padding-bottom: 8px;
}

// 占位与标签行等高
.article-tags-placeholder {
  min-height: 28px;
}

// .article-body 是 snapshot 样式钩子，叠加在 .article-detail 上（不替换）
.article-detail.article-body {
  // 清零旧 mt-24px，由容器 padding 控制间距
  margin-top: 0 !important;
  padding-top: 28px;

  // 选区色统一走 --slax-selection
  *::selection {
    background: var(--slax-selection);
  }

  // 正文排版
  :deep(.html-text) {
    p {
      font-size: var(--slax-fs-body);
      line-height: 1.85;
    }

    h2 {
      font-family: var(--slax-font-serif);
      font-size: var(--slax-fs-h2);
      font-weight: 500;
      margin-top: 24px;
    }

    img {
      border-radius: var(--slax-radius-sm);
      margin: 24px auto;
    }

    blockquote {
      border-left: 2px solid var(--slax-accent-soft);
      padding: 4px 20px;
      color: var(--slax-text-muted);
      font-style: italic;
    }

    .img-caption {
      font-size: var(--slax-fs-aux);
      font-weight: 300;
      color: var(--slax-text-light);
      text-align: center;
    }
  }

  &:deep(slax-mark.hl-flash) {
    text-decoration-color: var(--slax-accent);
    animation: hl-flash 5s ease-out;
  }

  @keyframes hl-flash {
    0% {
      background: color-mix(in srgb, var(--slax-accent) 22%, transparent);
    }
    100% {
      background: var(--slax-accent-bg);
    }
  }

  // 划线样式 token 化（普通详情页生效路径；iframe 路径走 mark.css）
  &:deep(slax-mark) {
    color: inherit;
    transition: all var(--slax-dur-normal);
  }

  // !important 压制插件注入的 CSS
  // 否则划线样式被插件覆盖
  &:deep(slax-mark.slax-mk-stroke) {
    cursor: pointer;
    text-decoration: underline dashed !important;
    text-decoration-color: color-mix(in srgb, var(--slax-accent) 50%, transparent) !important;
    text-decoration-thickness: 1.5px !important;
    text-underline-offset: 6px !important;
    box-decoration-break: clone;
    border-bottom: none !important;
  }

  &:deep(slax-mark.slax-mk-self-stroke) {
    cursor: pointer;
    text-decoration: underline dashed !important;
    text-decoration-color: color-mix(in srgb, var(--slax-accent) 50%, transparent) !important;
    text-decoration-thickness: 1.5px !important;
    text-underline-offset: 6px !important;
    box-decoration-break: clone;
    border-bottom: none !important;
  }

  &:deep(slax-mark.slax-mk-comment) {
    cursor: pointer;
    text-decoration: underline solid !important;
    text-decoration-color: color-mix(in srgb, var(--slax-accent) 50%, transparent) !important;
    text-decoration-thickness: 1.5px !important;
    text-underline-offset: 6px !important;
    box-decoration-break: clone;
    border-bottom: none !important;
  }

  // 划线+评论并存时统一用实线，
  // class 叠加抬高特异性压过 .stroke
  &:deep(slax-mark.slax-mk-comment.slax-mk-stroke) {
    text-decoration: underline solid !important;
    text-decoration-color: color-mix(in srgb, var(--slax-accent) 50%, transparent) !important;
  }

  &:deep(slax-mark.slax-mk-comment.slax-mk-self-stroke) {
    text-decoration: underline solid !important;
    text-decoration-color: color-mix(in srgb, var(--slax-accent) 50%, transparent) !important;
  }

  // 行末评论 icon：尾段渲染
  // 点 icon 可开评论面板
  &:deep(slax-mark.slax-mk-comment.slax-mk-comment-tail) {
    &::after {
      content: '';
      display: inline-block;
      width: 14px;
      height: 14px;
      margin-left: 4px;
      vertical-align: -2px;
      background-color: var(--slax-accent);
      -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14' fill='none' stroke-linejoin='round'><g transform='translate(2.3333, 3)' stroke='black' stroke-width='1.15'><path d='M0,0 L8.66666667,0 C9.0348565,0 9.33333333,0.298476833 9.33333333,0.666666667 L9.33333333,6.33333333 C9.33333333,6.70152317 9.0348565,7 8.66666667,7 L2.33333333,7 L0,8.66666667 L0,0 Z'/></g></svg>")
        no-repeat center / contain;
      mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14' fill='none' stroke-linejoin='round'><g transform='translate(2.3333, 3)' stroke='black' stroke-width='1.15'><path d='M0,0 L8.66666667,0 C9.0348565,0 9.33333333,0.298476833 9.33333333,0.666666667 L9.33333333,6.33333333 C9.33333333,6.70152317 9.0348565,7 8.66666667,7 L2.33333333,7 L0,8.66666667 L0,0 Z'/></g></svg>")
        no-repeat center / contain;
    }
  }

  // hover 任一段，整条划线高亮
  &:deep(slax-mark:hover),
  &:deep(slax-mark.group-hover) {
    text-decoration-color: var(--slax-accent);
    background: var(--slax-accent-bg);
  }

  // 引用高亮；压第三方内联底色
  &:deep(slax-mark.slax-mk-highlighted) {
    background-color: var(--slax-quote-highlight) !important;
    border-radius: 2px;
  }

  &:deep(slax-mark:has(img).slax-mk-stroke),
  &:deep(slax-mark:has(img).slax-mk-comment) {
    border: 1.5px solid var(--slax-accent) !important;
    text-decoration: none;
  }

  &:deep(slax-mark:has(img)) {
    --style: p-0px relative inline-block;

    &::after {
      content: '···';
      --style: absolute h-25px w-25px px-0px rounded-full -right-5px -top-5px line-height-25px text-txt-btn text-meta text-align-center transition-transform duration-normal;
      background-color: color-mix(in srgb, var(--slax-accent) 93%, transparent);
    }

    slax-mark {
      --style: '!p-0';
      &::after {
        --style: content-none;
      }
    }
  }

  &:deep(slax-mark slax-mark) {
    --style: '!border-none';
  }
}
</style>

<!-- eslint-disable-next-line vue-scoped-css/enforce-style-type -->
<style lang="scss">
@use '~~/styles/article/index.scss' as article;
@use '~~/styles/article/github-light.css' as *;

/* 该类下所有样式都是使用入侵的形式去调整，设置时可以根据下方注释的分类来进行对应设置 */

@mixin style($type) {
  @if $type == 'default' {
    @include article.article;
  } @else if $type == 'twitter' {
    @include article.twitter;
  } @else if $type == 'social-post' {
    @include article.social-post;
  } @else if $type == 'photo-swipe-topic' {
    @include article.photo-swipe-topic;
  } @else {
    @include article.article;
  }
}

.article-detail {
  --style: mt-24px hyphens-auto;
  @include article.reset;

  &.default {
    @include style('default');
  }

  &.twitter {
    @include style('twitter');
  }

  &.social-post {
    @include style('social-post');
  }

  &.photo-swipe-topic {
    @include style('photo-swipe-topic');
  }
}
</style>
