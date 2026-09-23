<template>
  <div class="bubble-message" :class="{ copyable: showCopyBtn, left: message.direction === 'left', right: message.direction === 'right' }">
    <div class="quote-container" v-if="message.quote && message.quote.data.length > 0" @click="quoteClick(message.quote)">
      <div class="quote">
        <i class="img bg-[url('@images/tiny-image-icon.png')]" v-if="showQuoteImage"></i>
        <span v-for="(item, index) in message.quote.data" :key="index">{{ item.type === 'image' ? '🖼️' : item.content }}</span>
      </div>
    </div>
    <div v-for="(content, index) in message.contents" :key="index">
      <template v-if="content.type === 'text'">
        <div class="text" v-if="!content.isHTML">
          {{ content.content }}
        </div>
        <div class="text" v-else v-html="content.content"></div>
      </template>
      <template v-else-if="content.type === 'links'">
        <div class="group links">
          <div class="links-title">{{ $t('component.chat_bubble_message.links_source') }}</div>
          <div class="links-content">
            <div class="content-wrapper">
              <div class="link-content" v-for="link in content.content" :key="link.url" @click="linkClick(link.url)">
                <div class="title">{{ link.title }}</div>
                <div class="href">
                  <!-- <i class="i-solar:link-minimalistic-2-linear"></i> -->
                  <img :src="link.icon" :width="12" :height="12" />
                  <span>{{ parseHref(link.url) }}</span>
                </div>
              </div>
            </div>
            <div class="operate group-hover:!opacity-100">
              <button class="left" @click="linksLeftOperateClick">
                <img v-if="!isDark()" src="@images/button-tiny-right-arrow-outline.png" alt="" />
                <img v-else src="@images/button-tiny-right-arrow-outline-dark.png" alt="" />
              </button>
              <button class="right" @click="linksRightOperateClick">
                <img v-if="!isDark()" src="@images/button-tiny-right-arrow-outline.png" alt="" />
                <img v-else src="@images/button-tiny-right-arrow-outline-dark.png" alt="" />
              </button>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="content.type === 'bookmarks'">
        <div class="group bookmarks">
          <div class="bookmarks-title">{{ $t('component.chat_bubble_message.bookmarks_source') }}</div>
          <div class="bookmarks-content">
            <div class="content-wrapper">
              <div class="bookmark-content" v-for="bookmark in content.content" :key="bookmark.bookmark_id" @click="bookmarkClick(bookmark.bookmark_id)">
                <div class="title">{{ bookmark.title || $t('component.chat_bot.bookmark_no_title') }}</div>
                <div class="content-preview">{{ bookmark.content || $t('component.chat_bot.bookmark_no_content') }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="content.type === 'tips'">
        <div class="tips">
          <span :class="{ loading: content.loading }">{{ content.tips }}</span>
        </div>
      </template>
      <template v-else-if="content.type === 'related-question'">
        <div class="related-question">
          <!-- <div class="related-question-title">{{ $t('component.chat_bubble_message.related_questions') }}</div> -->
          <div class="related-question-content">
            <div class="question" v-for="question in content.questions" :key="question.content" @click="questionClick(question)">
              <span class="text">{{ question.content }}</span>
              <i v-if="!isDark()" class="bg-[url('@images/button-tiny-bottom-search.png')]"></i>
              <i v-else class="bg-[url('@images/button-tiny-bottom-search-dark.png')]" />
            </div>
          </div>
        </div>
      </template>
    </div>
    <div class="btns-container" v-if="showCopyBtn">
      <button class="copy-btn" @click="copyBtnClick">
        <img v-if="!isDark()" src="@images/button-tiny-copy.png" />
        <img v-else src="@images/button-tiny-copy-dark.png" />
      </button>
    </div>
    <div class="dark-trigger" ref="darkTrigger" />
  </div>
</template>

<script lang="ts" setup>
import { copyText } from '@commons/frontend-utils/string'

import { type BubbleMessageItem, type QuoteData } from './type'
import Toast, { ToastType } from '~/components/Toast'

const emits = defineEmits(['questionClick', 'quoteClick'])
const props = defineProps({
  message: {
    type: Object as PropType<BubbleMessageItem>,
    required: true
  }
})

const { t } = useI18n()
const darkTrigger = ref<HTMLDivElement>()

const showCopyBtn = computed(() => {
  const isBuffering = props.message.isBuffering
  const isLeftMessage = props.message.direction === 'left'
  const hasTextMessage = props.message.contents?.some(content => content.type === 'text')
  return !isBuffering && isLeftMessage && hasTextMessage
})

const showQuoteImage = computed(() => {
  return props.message.quote && props.message.quote.data.length > 0 && !!props.message.quote.data.find(item => item.type === 'image')
})

const isDark = () => {
  if (!darkTrigger.value) {
    return false
  }

  const style = window.getComputedStyle(darkTrigger.value)
  return style.opacity === '1'
}

const parseHref = (href: string) => {
  const url = new URL(href)
  const hostname = url.hostname
  const items = hostname.split('.')
  return items.length <= 2 ? items[0] : items[1]
}

const queryContentWrapperElement = (e: PointerEvent) => {
  console.log(e)
  let parentContainer = null
  if (e.target instanceof HTMLImageElement) {
    parentContainer = (e.target as HTMLImageElement).parentElement?.parentElement?.parentElement
  } else if (e.target instanceof HTMLButtonElement) {
    parentContainer = (e.target as HTMLButtonElement).parentElement?.parentElement
  }

  if (!parentContainer) {
    return null
  }

  const contentWrapper = parentContainer.querySelector('.content-wrapper')
  return contentWrapper as HTMLDivElement
}

const linksLeftOperateClick = (e: MouseEvent) => {
  const contentWrapper = queryContentWrapperElement(e as PointerEvent)
  contentWrapper?.scrollTo({
    left: contentWrapper.scrollLeft - 320,
    behavior: 'smooth'
  })
}

const linksRightOperateClick = (e: MouseEvent) => {
  const contentWrapper = queryContentWrapperElement(e as PointerEvent)
  contentWrapper?.scrollTo({
    left: contentWrapper.scrollLeft + 320,
    behavior: 'smooth'
  })
}

const linkClick = (href: string) => {
  window.open(href)
}

const bookmarkClick = (bookmarkId: number) => {
  pwaOpen({
    url: `/bookmarks/${bookmarkId}`
  })
}

const copyBtnClick = async () => {
  const contentText =
    props.message.contents
      ?.filter(content => content.type === 'text')
      .map(content => content.rawContent || '')
      .join('\n') || ''

  const processedText = contentText
    .split('\n')
    .map(line => {
      if (/^\s*-/.test(line)) {
        return line.replace('-', '·')
      } else if (line.startsWith('#')) {
        return line.replace(/^#+\s/, '\n')
      }
      return line
    })
    .join('\n')
    .trim()

  await copyText(processedText)
  Toast.showToast({
    text: t('common.tips.copy_content_success'),
    type: ToastType.Success
  })
}

const questionClick = (question: { content: string; rawContent?: string }) => {
  emits('questionClick', props.message, question)
}

const quoteClick = (quote: QuoteData) => {
  emits('quoteClick', quote)
}
</script>

<style lang="scss" scoped>
.bubble-message {
  --style: relative min-h-10 min-w-300px rounded-8px p-16px bg-surface;

  .dark-trigger {
    --style: 'absolute left-0 top-0 w-0 h-0 opacity-0 dark:opacity-100';
  }

  &.copyable {
    --style: '!pb-48px';
  }

  &.left {
    // dark 模式下 left bubble 让外层接管背景（透明），保留 dark:bg-transparent override
    --style: 'ml-0 mr-auto justify-start mr-50px bg-surface text-txt dark:(bg-transparent text-txt)';
  }

  &.right {
    // right bubble 是用户消息气泡，深色背景+浅文字，与全站主题反色（light/dark 都用深底白字），保留
    --style: 'mr-0 my-8px ml-auto justify-end min-w-auto max-w-366px bg-#333 text-#fcfcfc dark:(bg-#333 text-#ffffffe6)';
  }

  & > *:not(.dark-trigger) {
    --style: 'not-first:mt-16px';
  }

  .quote-container {
    --style: flex items-center justify-between cursor-pointer;
    .quote {
      // 引用块在 right bubble (深底白字) 内：左边线 / 文字色绑定 user-bubble 反色体系，保留
      --style: 'pl-8px border-l-(2px solid #fcfcfc29) line-clamp-2 text-(meta) text-#fcfcfc99 dark:text-#ffffff66';

      i.img {
        --style: w-13px h-13px inline-block bg-contain mr-4px translate-y-2px;
      }

      span {
        --style: line-height-21px overflow-hidden;
      }
    }
  }

  .text {
    --style: flex flex-col text-(meta) line-height-22px whitespace-pre-line;
    text-autospace: normal;

    &:deep(& :not(code)) {
      --style: m-0 text-txt;
    }

    &:deep(.hljs) {
      // 代码块底色 light=半透明黑 / dark=半透明白，专属反色对位（不能用 border token，含意不同），保留
      --style: 'bg-#33333314 dark:bg-#FFFFFFE6';
    }

    &:deep(pre) {
      --style: mt-16px;
    }

    &:deep(h1) {
      --style: 'font-bold text-(brand) line-height-28px not-first:mt-32px';
    }

    &:deep(h2) {
      --style: 'font-bold text-(body) line-height-22px not-first:mt-22px';
    }

    &:deep(h3),
    &:deep(h4),
    &:deep(h5) {
      --style: 'font-bold text-(meta) not-first:mt-12px';
    }

    // 非标题类内容，在前面有内容时才增加间距
    &:deep(* + ul),
    &:deep(* + ol) {
      --style: mt-10px;
      margin-top: 10px;
    }

    &:deep(li) {
      --style: relative pl-20px box-border font-normal text-(meta) line-height-20px whitespace-normal;
    }

    &:deep(ul),
    &:deep(ol) {
      --style: list-none whitespace-normal;
    }

    &:deep(ul) {
      --style: pl-0 flex flex-col;
      li {
        &::marker {
          // #a8b1cd 列表 marker 蓝灰辅助色（与 BookmarkArticle / MarkdownText 同源），保留
          --style: content-none hidden text-#a8b1cd;
        }

        & li {
          &::marker {
            // #a8b1cd 嵌套列表 marker 蓝灰辅助色（与上层 marker 同源），保留
            --style: content-none hidden text-#a8b1cd;
          }
          &:before {
            // #a8b1cd 是嵌套列表 marker 的蓝灰辅助色（与 BookmarkArticle 同源），保留
            --style: box-border top-8px left-4px w-4px h-4px border border-#a8b1cd border-solid bg-surface-solid;
          }
        }

        &:not(:first-child) {
          --style: 'not-first:mt-14px';
        }

        &:before {
          // #a8b1cd 列表 bullet 蓝灰辅助色（与 marker 同源），保留
          --style: absolute top-8px left-4px w-4px h-4px bg-#a8b1cd content-empty rounded;
        }
      }
    }

    &:deep(ol) {
      --style: pl-0 flex flex-col;
      counter-reset: list-counter;

      & > li {
        counter-increment: list-counter;
        &::marker {
          --style: content-empty;
        }

        &:not(:first-child) {
          --style: 'not-first:mt-14px';
        }

        &::before {
          --style: 'content-empty !absolute rounded-full top-0px left-4px';
          content: counter(list-counter) '. '; /* 显示计数器 */
        }
      }
    }

    &:deep(a) {
      // #5490C2 第三方蓝色锚点（twitter / 链接体系），保留
      --style: text-#5490C2 underline-none border-none decoration-none cursor-pointer;
    }

    &:deep(table) {
      --style: border-collapse;
    }

    &:deep(thead),
    &:deep(td),
    &:deep(tr),
    &:deep(th) {
      --style: border-(1px solid border) p-4px text-align-center;
    }

    &:deep(* + p) {
      --style: mt-22px;
    }

    &:deep(code) {
      font-family: var(--slax-font-mono) !important;

      * {
        font-family: var(--slax-font-mono) !important;
      }
    }
  }

  .links {
    --style: relative w-full;

    .links-title {
      --style: text-(tag) line-height-17px text-txt-light;
    }

    .links-content {
      --style: mt-6px w-full relative;
      &::before {
        --style: content-empty absolute w-5px h-full right-0px top-0 bg-gradient-to-l to-transprent z-2 from-surface;
      }

      &::after {
        --style: content-empty absolute w-5px h-full -left-5px top-0 bg-gradient-to-r to-transprent z-2 from-surface;
      }

      .content-wrapper {
        --style: w-calc(100% + 5px) -ml-5px p-5px overflow-x-auto flex flex-nowrap relative;
        scrollbar-width: none;
        &::-webkit-scrollbar {
          --style: hidden;
        }
        .link-content {
          --style: 'flex flex-col justify-between p-8px w-160px h-69px border-(1px solid) shrink-0 rounded-4px cursor-pointer transition-all duration-normal not-first:ml-8px bg-surface-solid border-border hover:(bg-surface shadow-sm)';

          .title {
            --style: text-(tag) line-height-17px line-clamp-2 text-txt;
          }

          .href {
            --style: flex items-center text-(tag) text-txt-light;

            i {
              --style: w-9px h-8px;
            }

            span {
              --style: ml-5px line-height-17px;
            }
          }
        }
      }

      .operate {
        --style: 'absolute right-0 top-0 -translate-y-full flex pb-9px opacity-0 transition-opacity duration-normal';

        button {
          --style: w-11px h-10px flex-center rounded-full transition-transform duration-normal;

          &:hover {
            --style: scale-105;
          }
          img {
            --style: w-11px h-10px object-center;
          }
        }

        .left {
          --style: left-0 rotate-180;
        }

        .right {
          --style: right-0;
        }
      }
    }
  }

  .bookmarks {
    --style: relative w-full;

    .bookmarks-title {
      --style: text-(tag) line-height-17px mb-8px text-txt-light;
    }

    .bookmarks-content {
      .content-wrapper {
        --style: flex flex-col gap-8px;

        .bookmark-content {
          --style: 'p-12px border-(1px solid) rounded-8px cursor-pointer transition-all duration-200 bg-surface-solid border-border hover:(bg-surface shadow-md)';

          .title {
            --style: text-(meta) font-medium line-height-20px line-clamp-2 text-txt mb-6px;
          }

          .content-preview {
            --style: text-(tag) line-height-16px line-clamp-3 text-txt-muted;
          }
        }
      }
    }
  }

  .tips {
    --style: flex items-center;
    span {
      --style: text-(tag) line-height-17px text-txt-light;

      &.loading {
        animation: loading 1.5s linear infinite;
      }
    }

    @keyframes loading {
      0% {
        opacity: 100%;
      }

      50% {
        opacity: 50%;
      }

      100% {
        opacity: 100%;
      }
    }
  }

  .related-question {
    --style: max-w-366px;
    .related-question-title {
      --style: text-(tag) line-height-17px text-txt-light;
    }

    .related-question-content {
      --style: mt-10px;
      .question {
        --style: 'py-0px pl-16px flex items-center justify-between relative not-first:mt-10px cursor-pointer';

        &::before {
          // #a8b1cd 蓝灰装饰圆点（与列表 marker 同色板），保留
          --style: 'content-empty absolute left-0 top-1/2 w-4px h-4px -translate-y-1/2 rounded-2px bg-#a8b1cd dark:bg-#ffffff66';
        }

        span {
          --style: text-(meta) line-height-22px text-txt;
        }

        i {
          --style: shrink-0 w-16px h-16px bg-contain transition-transform duration-normal ml-12px;
        }
      }
    }
  }

  .btns-container {
    --style: absolute left-16px bottom-16px flex;

    .copy-btn {
      --style: 'w-16px h-16px flex-center rounded-3px bg-contain active:(scale-110) transition-all duration-normal ease-in-out';

      &:hover {
        --style: scale-105 bg-surface;
      }

      img {
        --style: w-full h-full object-contain;
      }
    }
  }
}
</style>
