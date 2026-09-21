<template>
  <div class="markdown-text" ref="markdownTextContainer">
    <div class="markdown-content" lang="en" v-html="markdownHTMLText"></div>
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
      href: matches[1],
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
    --style: flex flex-col hyphens-auto;
    &:deep(*) {
      --style: m-0;
      --style: 'text-#0f1419 dark:text-#ffffffe6';
    }

    &:deep(h1) {
      --style: font-bold text-20px line-height-28px;
      --style: 'not-first:mt-32px text-0f1419 dark:text-#ffffffe6';
    }

    &:deep(h2) {
      --style: font-bold text-16px line-height-22px mt-32px;
      --style: 'text-#0f1419 dark:text-#ffffffcc';
    }

    &:deep(h3),
    &:deep(h4),
    &:deep(h5) {
      --style: font-bold text-12px mt-20px;
      --style: 'text-#0f1419 dark:text-#ffffffcc';
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
        --style: relative pl-20px box-border font-normal text-14px line-height-20px;
        --style: 'text-#333333 dark:text-#ffffff99';

        &::marker {
          --style: content-none hidden;
          --style: 'text-#a8b1cd dark:text-#A8B1CD66';
        }

        & li {
          &::marker {
            --style: content-none hidden;
            --style: 'text-#a8b1cd dark:text-#A8B1CD66';
          }
          &:before {
            --style: box-border top-8px left-4px w-4px h-4px border border-solid;
            --style: 'bg-#fff border-#a8b1cd dark:bg-#A8B1CD66 dark:border-#A8B1CD66';
          }
        }

        &:not(:first-child) {
          --style: 'not-first:mt-14px';
        }

        &:before {
          --style: absolute top-8px left-4px w-4px h-4px content-empty rounded;
          --style: 'bg-#a8b1cd dark:bg-#A8B1CD66';
        }
      }
    }

    &:deep(a) {
      --style: -top-1px relative text-#5080a8;
    }

    &:deep(a:not(.slax_link)) {
      color: #5080a8;
    }

    &:deep(.slax_link) {
      --style: ml-0 select-none cursor-pointer align-middle h-16px line-height-16px py-3px px-5px font-500 text-10px rounded-3px transition-colors duration-150;
      --style: '!decoration-none bg-#16b9981f text-#333333  dark:text-#ffffff99';
    }

    &:deep(.slax_link:hover) {
      --style: 'bg-#475467 !text-#fff';
    }
  }
}
</style>
