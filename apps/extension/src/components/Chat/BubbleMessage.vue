<template>
  <div class="bubble-message" :class="{ copyable: showCopyBtn, left: message.direction === 'left', right: message.direction === 'right' }">
    <div class="quote-container" v-if="message.quote && message.quote.data.length > 0" @click="quoteClick(message.quote)">
      <div class="quote">
        <i class="img bg-[url('@/assets/tiny-image-icon.png')]" v-if="showQuoteImage"></i>
        <span v-for="item in message.quote.data" :key="item.content">{{ item.content }}</span>
      </div>
    </div>
    <div v-for="(content, index) in message.contents" :key="index">
      <template v-if="content.type === 'text'">
        <div class="text" lang="en" v-if="!content.isHTML">
          {{ content.content }}
        </div>
        <div class="text" lang="en" v-else v-html="content.content"></div>
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
                <img src="@/assets/button-tiny-right-arrow-outline.png" alt="" />
              </button>
              <button class="right" @click="linksRightOperateClick">
                <img src="@/assets/button-tiny-right-arrow-outline.png" alt="" />
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
                <div class="title">{{ bookmark.title || 'No Title' }}</div>
                <div class="content-preview">{{ bookmark.content || 'No Content' }}</div>
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
              <i class="bg-[url('@/assets/button-tiny-bottom-search.png')]"></i>
            </div>
          </div>
        </div>
      </template>
    </div>
    <div class="btns-container" v-if="showCopyBtn">
      <button class="copy-btn" @click="copyBtnClick">
        <img src="@/assets/button-tiny-copy.png" />
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { copyText } from '@commons/utils/string'

import Toast, { ToastType } from './../Toast'
import { type BubbleMessageItem, type QuoteData } from './type'

const emits = defineEmits(['questionClick', 'quoteClick'])
const props = defineProps({
  message: {
    type: Object as PropType<BubbleMessageItem>,
    required: true
  }
})

const showCopyBtn = computed(() => {
  const isBuffering = props.message.isBuffering
  const isLeftMessage = props.message.direction === 'left'
  const hasTextMessage = props.message.contents?.some(content => content.type === 'text')
  return !isBuffering && isLeftMessage && hasTextMessage
})

const showQuoteImage = computed(() => {
  return props.message.quote && props.message.quote.data.length > 0 && !!props.message.quote.data.find(item => item.type === 'image')
})

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
  window.open(`${process.env.PUBLIC_BASE_URL}/bookmarks/${bookmarkId}`, '_blank')
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
    text: $t('common.tips.copy_content_success'),
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
  --style: relative bg-#1F1F1FFF min-h-10 min-w-300px rounded-8px p-16px;

  &.copyable {
    --style: '!pb-48px';
  }

  &.left {
    --style: ml-0 mr-auto justify-start bg-transparent text-(#fff) mr-0;
  }

  &.right {
    --style: mr-0 my-8px ml-auto justify-end bg-#333 text-(#ffffffe6) min-w-auto max-w-366px;
  }

  & > * {
    --style: 'not-first:mt-16px';
  }

  .quote-container {
    --style: flex items-center justify-between cursor-pointer;
    .quote {
      --style: pl-8px border-l-(2px solid #fcfcfc29) line-clamp-2 text-(15px #ffffff66);
      i.img {
        --style: w-13px h-13px inline-block bg-contain mr-4px translate-y-2px;
      }

      span {
        --style: line-height-21px overflow-hidden;
      }
    }
  }

  .text {
    --style: flex flex-col text-(15px) line-height-22px whitespace-pre-line hyphens-auto;
    text-autospace: normal;

    &:deep(& :not(code)) {
      --style: m-0 text-#FFFFFFE6;
    }

    &:deep(.hljs) {
      --style: bg-#FFFFFFE6;
    }

    &:deep(pre) {
      --style: mt-16px;
    }

    &:deep(h1) {
      --style: 'font-bold text-(20px) line-height-28px not-first:mt-32px';
    }

    &:deep(h2) {
      --style: 'font-bold text-(16px) line-height-22px not-first:mt-22px';
    }

    &:deep(h3),
    &:deep(h4),
    &:deep(h5) {
      --style: 'font-bold text-(15px) not-first:mt-12px';
    }

    // 非标题类内容，在前面有内容时才增加间距
    &:deep(* + ul),
    &:deep(* + ol) {
      --style: mt-10px;
      margin-top: 10px;
    }

    &:deep(li) {
      --style: relative pl-20px box-border font-normal text-(14px) line-height-20px whitespace-normal;
    }

    &:deep(ul),
    &:deep(ol) {
      --style: list-none whitespace-normal;
    }

    &:deep(ul) {
      --style: pl-0 flex flex-col;
      li {
        &::marker {
          --style: content-none hidden text-#a8b1cd;
        }

        & li {
          &::marker {
            --style: content-none hidden text-#a8b1cd;
          }
          &:before {
            --style: box-border top-8px left-4px w-4px h-4px border border-#a8b1cd border-solid bg-#fff;
          }
        }

        &:not(:first-child) {
          --style: 'not-first:mt-14px';
        }

        &:before {
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
      --style: text-#5490C2 underline-none border-none decoration-none cursor-pointer;
    }

    &:deep(table) {
      --style: border-collapse;
    }

    &:deep(thead),
    &:deep(td),
    &:deep(tr),
    &:deep(th) {
      --style: border-(1px solid #9999991a) p-4px text-align-center;
    }

    &:deep(* + p) {
      --style: mt-22px;
    }

    &:deep(code) {
      font-family: 'Courier New', Courier, monospace !important;

      * {
        font-family: 'Courier New', Courier, monospace !important;
      }
    }
  }

  .links {
    --style: relative w-full select-none;

    .links-title {
      --style: text-(12px #999999ff) line-height-17px;
    }

    .links-content {
      --style: mt-6px w-full relative;
      &::before {
        --style: content-empty absolute w-5px h-full right-0px top-0 bg-gradient-to-l from-#262626FF to-transprent z-2;
      }

      &::after {
        --style: content-empty absolute w-5px h-full -left-5px top-0 bg-gradient-to-r from-#262626FF to-transprent z-2;
      }

      .content-wrapper {
        --style: w-calc(100% + 5px) -ml-5px p-5px overflow-x-auto flex flex-nowrap relative;
        scrollbar-width: none;
        &::-webkit-scrollbar {
          --style: hidden;
        }
        .link-content {
          --style: 'flex flex-col justify-between p-8px w-160px h-69px bg-#1F1F1FFF border-(1px solid #FFFFFF0A) shrink-0 rounded-4px not-first:ml-8px cursor-pointer transition-all duration-250 hover:(bg-#191919FF)';

          .title {
            --style: text-(12px #ffffff99) line-height-17px line-clamp-2;
          }

          .href {
            --style: flex items-center text-(12px #ffffff33);

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
        --style: 'absolute right-0 top-0 -translate-y-full flex pb-9px opacity-0 transition-opacity duration-250';

        button {
          --style: w-11px h-10px flex-center rounded-full transition-transform duration-250;

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
    --style: relative w-full select-none;

    .bookmarks-title {
      --style: text-(12px) line-height-17px mb-8px;
      --style: 'text-#999 dark:text-#999999ff';
    }

    .bookmarks-content {
      .content-wrapper {
        --style: flex flex-col gap-8px;

        .bookmark-content {
          --style: 'p-12px border-(1px solid) rounded-8px cursor-pointer transition-all duration-200 bg-#2a2a2a border-#404040 hover:bg-#333333';

          .title {
            --style: text-(14px) font-medium line-height-20px line-clamp-2 text-#ffffff mb-6px;
          }

          .content-preview {
            --style: text-(12px) line-height-16px line-clamp-3 text-#999;
          }
        }
      }
    }
  }

  .tips {
    --style: flex items-center select-none;
    span {
      --style: text-(12px #ffffff99) line-height-17px;

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
    --style: max-w-366px select-none;
    .related-question-title {
      --style: text-(12px #ffffff66) line-height-17px;
    }

    .related-question-content {
      --style: mt-10px;
      .question {
        --style: 'py-0px pl-16px flex items-center justify-between relative not-first:mt-10px cursor-pointer';

        &::before {
          --style: content-empty absolute left-0 top-1/2 w-4px h-4px bg-#FFFFFF66 -translate-y-1/2 rounded-2px;
        }

        span {
          --style: text-(15px #ffffff99) line-height-22px;
        }

        i {
          --style: shrink-0 w-16px h-16px bg-contain transition-transform duration-250 ml-12px;
        }
      }
    }
  }

  .btns-container {
    --style: absolute left-16px bottom-16px flex;

    .copy-btn {
      --style: 'w-16px h-16px flex-center rounded-3px bg-contain hover:(bg-#1F1F1FFF scale-105) active:(scale-110) transition-all duration-250 ease-in-out';
      img {
        --style: w-full h-full object-contain;
      }
    }
  }
}
</style>
