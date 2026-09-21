<template>
  <div class="markdown-text" ref="markdownTextContainer">
    <div class="markdown-content" v-html="markdownHTMLText"></div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'

import { parseMarkdownText } from '@commons/utils/parse'

import 'highlight.js/styles/atom-one-dark.css'

const props = defineProps<{ text: string }>()
const emits = defineEmits(['anchorClick'])

const markdownTextContainer = ref<HTMLDivElement>()
const markdownHTMLText = ref('')

watch(
  () => props.text,
  () => {
    update()
  }
)

const parseHTML = (html: string) => {
  const reg = new RegExp(/\<a href\=\"(anchor_.+?)\" rel\=\"noopener\"\>(.+?)\<\/a\>/g)
  let matches: RegExpExecArray | null = null

  const result: { text: string; href: string }[] = []
  while ((matches = reg.exec(html)) !== null) {
    result.push({
      href: matches[1] ?? '',
      text: matches[0]
    })
  }

  result.forEach(item => {
    html = html.replaceAll(item.text, item.text.replace(`href="${item.href}"`, `class="slax_link" data-link="${item.href}"`))
  })

  return html
}

const update = () => {
  const rawHTML = parseMarkdownText(props.text)
  const parsedHTML = parseHTML(rawHTML)

  markdownHTMLText.value = parsedHTML
  nextTick(() => {
    handleAnchors()
  })
}

update()

const handleAnchors = () => {
  Array.from(markdownTextContainer.value!.querySelectorAll('.markdown-content .slax_link')).forEach(dom => {
    const anchorDom = dom as HTMLAnchorElement
    if (anchorDom.onclick) {
      return
    }

    const link = anchorDom.dataset['link']
    anchorDom.onclick = () => {
      emits('anchorClick', link)
    }
  })
}
</script>

<style lang="scss" scoped>
.markdown-text {
  .markdown-content {
    --style: flex flex-col;
    &:deep(*) {
      --style: m-0 text-txt;
    }

    &:deep(h1) {
      --style: font-bold text-brand line-height-28px;
      // 顺手修复原写法 `text-0f1419` 缺 `#` 的笔误（编译时被丢弃，无 color 输出）
      --style: 'not-first:mt-32px text-txt';
    }

    &:deep(h2) {
      --style: font-bold text-body line-height-22px mt-32px text-txt;
    }

    &:deep(h3),
    &:deep(h4),
    &:deep(h5) {
      --style: font-bold text-tag mt-20px text-txt;
    }

    // 非标题类内容，在前面有内容时才增加间距
    &:deep(* + ul),
    &:deep(* + ol),
    &:deep(li > ul),
    &:deep(li > ol) {
      --style: mt-16px;
    }

    &:deep(ul) {
      --style: pl-0 flex flex-col list-none;
      li {
        --style: relative pl-20px box-border font-normal text-meta line-height-20px text-txt;

        // #a8b1cd / #A8B1CD66 列表 marker 与嵌套 marker 都是蓝灰辅助色板，与 BubbleMessage / BookmarkArticle 同源，保留
        &::marker {
          --style: 'content-none hidden text-#a8b1cd dark:text-#A8B1CD66';
        }

        & li {
          &::marker {
            --style: 'content-none hidden text-#a8b1cd dark:text-#A8B1CD66';
          }
          &:before {
            --style: 'box-border top-8px left-4px w-4px h-4px border border-solid bg-surface-solid border-#a8b1cd dark:(bg-#A8B1CD66 border-#A8B1CD66)';
          }
        }

        &:not(:first-child) {
          --style: 'not-first:mt-14px';
        }

        &:before {
          --style: 'absolute top-8px left-4px w-4px h-4px content-empty rounded bg-#a8b1cd dark:bg-#A8B1CD66';
        }
      }
    }

    &:deep(a) {
      // 日夜强调色，E-ink 经典蓝
      --style: -top-1px relative;
      color: var(--slax-link);
    }

    // 真实外链：E-ink 加 ↗︎ 后缀
    &:deep(a:not(.slax_link)) {
      color: var(--slax-link);

      &::after {
        content: var(--slax-link-suffix, '');
      }
    }

    &:deep(.slax_link) {
      --style: ml-0 select-none cursor-pointer align-middle h-16px line-height-16px py-3px px-5px font-500 text-tag rounded-3px transition-colors duration-fast;
      // bg-#16b9981f 当前品牌绿淡背景，与列表蓝灰辅助色一同保留
      --style: '!decoration-none bg-#16b9981f text-txt';
    }

    &:deep(.slax_link:hover) {
      // hover 反色状态（深蓝灰底 + 白字），与全站主题无关，保留
      --style: 'bg-#475467 !text-#fff';
    }
  }
}
</style>
