<template>
  <div class="snapshot-ai-panel">
    <!-- 全文概要区域：仅在有 bookmarkId 时支持（shareCode 不支持 overview） -->
    <section class="panel-overview" v-if="overviewSupported">
      <div class="panel-overview-label">{{ $t('component.ai_panel.overview_label') }}</div>

      <!-- 加载骨架（首次加载、尚无内容时） -->
      <div class="overview-skeleton" v-if="overviewLoading && overviewContent.length === 0">
        <div class="skeleton-row" v-for="(_, index) in Array.from({ length: 3 })" :key="index"></div>
      </div>

      <!-- 概要内容 -->
      <template v-else-if="overviewContent.length > 0">
        <div class="panel-overview-text">{{ overviewContent }}</div>
        <div class="overview-loading-bottom" v-if="overviewLoading">
          <DotLoading />
        </div>
        <ul class="panel-keypoints" v-if="keyTakeaways.length > 0">
          <li v-for="(item, index) in keyTakeaways" :key="index">{{ item }}</li>
        </ul>
      </template>

      <!-- 加载失败重试 -->
      <div class="overview-retry" v-else-if="overviewError">
        <button class="retry-btn" @click="loadOverview()">{{ $t('component.ai_panel.retry') }}</button>
      </div>
    </section>

    <div class="panel-divider" v-if="overviewSupported"></div>

    <!-- 全文解析区域 -->
    <section class="panel-outline">
      <!-- 标题带 grid icon，对齐 demo 的 .panel-action 样式 -->
      <div class="panel-outline-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 3v18" />
        </svg>
        {{ $t('component.ai_panel.outline_label') }}
      </div>

      <!-- 加载骨架（首次加载、尚无内容时） -->
      <div class="outline-skeleton" v-if="outlineLoading && outlineText.length === 0">
        <div class="skeleton-row" v-for="(_, index) in Array.from({ length: 3 })" :key="index"></div>
      </div>

      <!-- 大纲内容 -->
      <template v-else-if="outlineText.length > 0">
        <MarkdownText class="panel-outline-text" :text="outlineText" @anchor-click="handleAnchorClick" />
        <div class="outline-loading-bottom" v-if="outlineLoading">
          <DotLoading />
        </div>
      </template>

      <!-- 加载失败重试 -->
      <div class="outline-retry" v-else-if="outlineError">
        <button class="retry-btn" @click="loadOutline()">{{ $t('component.ai_panel.retry') }}</button>
      </div>
    </section>

    <!-- 文案同 /bookmarks 列表底部 -->
    <div class="panel-end" v-if="showEndHint">
      <ListEndHint :text="$t('page.bookmarks_index.no_more')" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import DotLoading from '~/components/DotLoading.vue'
import ListEndHint from '~/components/ListEndHint.vue'
import MarkdownText from '~/components/Markdown/MarkdownText.vue'

import { extractMarkdownFromText } from '@commons/frontend-utils/parse'
import { RequestMethodType } from '@commons/frontend-utils/request'
import { findMatchingElement, queryMarkdownAnchorQuote, querySimularMarkdownAnchorQuote } from '@commons/frontend-utils/search'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { SummaryItemModel } from '@slax-reader/contracts/interface'
import { useSnapshotLayout } from '~/composables/useSnapshotLayout'

// outline 锚点跳转映射
const anchorRefs: Record<string, string> = {}

const emit = defineEmits(['dismiss'])

// 小屏点击锚点后收起侧栏
const { isH5 } = useSnapshotLayout()

const processOutlineAnchors = (text: string): string => {
  // 完整格式锚点：[text](anchor_N)
  const anchors = queryMarkdownAnchorQuote(text)
  const anchorIndexes = anchors.map(a => a.index)
  anchors.forEach(anchor => {
    const key = `anchor_${anchor.anchorNum}`
    anchorRefs[key] = anchor.text
    text = text.replaceAll(anchor.anchorText, ` [${decodeURIComponent(anchor.anchorNum)}](${key})`)
  })
  // 不完整格式锚点（#url）：去掉链接只保留文字
  const simAnchors = querySimularMarkdownAnchorQuote(text).filter(a => !anchorIndexes.includes(a.index))
  simAnchors.forEach(anchor => {
    text = text.replaceAll(anchor.anchorText, ` ${decodeURIComponent(anchor.anchorNum)}`)
  })
  return text
}

// 找最近可滚动祖先，无则回退 window
const getScrollParent = (el: HTMLElement): HTMLElement | null => {
  let parent = el.parentElement
  while (parent) {
    const { overflowY } = getComputedStyle(parent)
    if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && parent.scrollHeight > parent.clientHeight) {
      return parent
    }
    parent = parent.parentElement
  }
  return null
}

// 固定时长平滑滚动至居中（原生 smooth 太慢易错过高亮），跨段落时传 range 矩形定位
const smoothScrollToCenter = (el: HTMLElement, rect: DOMRect = el.getBoundingClientRect(), duration = 360): Promise<void> => {
  return new Promise(resolve => {
    const scroller = getScrollParent(el)
    const isWindow = !scroller
    const viewportH = isWindow ? window.innerHeight : scroller!.clientHeight
    const scrollHeight = isWindow ? document.documentElement.scrollHeight : scroller!.scrollHeight
    const startTop = isWindow ? window.scrollY : scroller!.scrollTop

    const elRect = rect
    const baseTop = isWindow ? elRect.top + window.scrollY : startTop + (elRect.top - scroller!.getBoundingClientRect().top)
    const maxTop = Math.max(0, scrollHeight - viewportH)
    const targetTop = Math.max(0, Math.min(baseTop - viewportH / 2 + elRect.height / 2, maxTop))

    const distance = targetTop - startTop
    if (Math.abs(distance) < 1) {
      resolve()
      return
    }

    const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    let startTime: number | null = null
    const step = (now: number) => {
      if (startTime === null) startTime = now
      const progress = Math.min((now - startTime) / duration, 1)
      const top = startTop + distance * easeInOutCubic(progress)
      if (isWindow) {
        window.scrollTo(0, top)
      } else {
        scroller!.scrollTop = top
      }
      if (progress < 1) {
        requestAnimationFrame(step)
      } else {
        resolve()
      }
    }
    requestAnimationFrame(step)
  })
}

// 按文字用 <mark> 包裹高亮，而非整个容器
const flashRange = (range: Range): HTMLElement[] => {
  const textNodes: Text[] = []
  const root = range.commonAncestorContainer
  if (root.nodeType === Node.TEXT_NODE) {
    // 未跨元素时本身就是文本节点
    textNodes.push(root as Text)
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    })
    let node = walker.nextNode()
    while (node) {
      textNodes.push(node as Text)
      node = walker.nextNode()
    }
  }

  const marks: HTMLElement[] = []
  textNodes.forEach(textNode => {
    const subRange = document.createRange()
    subRange.selectNodeContents(textNode)
    if (textNode === range.startContainer) subRange.setStart(textNode, range.startOffset)
    if (textNode === range.endContainer) subRange.setEnd(textNode, range.endOffset)
    if (subRange.collapsed) return

    const mark = document.createElement('mark')
    mark.className = 'anchor-flash'
    try {
      subRange.surroundContents(mark)
      marks.push(mark)
    } catch {
      // 极少数情况会抛错，跳过
    }
  })

  return marks
}

const unflash = (marks: HTMLElement[]) => {
  marks.forEach(mark => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

const handleAnchorClick = async (link: string) => {
  const refText = anchorRefs[link]
  if (!refText) return
  // 在正文区查找目标文本
  const contentEl = document.querySelector('.bookmark-detail .detail') || document.body
  const result = findMatchingElement(refText, contentEl)
  if (result?.element && result.range) {
    const el = result.element as HTMLElement
    // 小屏先收起侧栏避免遮挡
    if (isH5.value) {
      emit('dismiss')
      // 等布局回流后再滚动
      await nextTick()
    }
    // 先滚到位再高亮，确保可见
    await smoothScrollToCenter(el, result.range.getBoundingClientRect())
    const marks = flashRange(result.range)
    setTimeout(() => unflash(marks), 3000)
  }
}

const props = defineProps({
  bookmarkId: {
    type: Number,
    required: false
  },
  shareCode: {
    type: String,
    required: false
  },
  // /b/[id] 的 bookmark_uid
  bookmarkUid: {
    type: String,
    required: false
  },
  // SSR 已带 outline 时直接用
  defaultOutline: {
    type: String,
    required: false
  },
  // overview 是否可用，默认 true；/b/[id] 非 owner 传 false 隐藏（后端 owner-only）
  overviewEnabled: {
    type: Boolean,
    required: false,
    default: true
  },
  isAppeared: {
    type: Boolean,
    required: false,
    default: false
  }
})

// overview 支持 bookmarkId/bookmarkUid，shareCode 不支持；enabled 为 false 时隐藏（owner-only）
const overviewSupported = computed(() => props.overviewEnabled && (!!props.bookmarkId || !!props.bookmarkUid))

// 有内容且加载结束时展示
const showEndHint = computed(() => {
  const hasContent = overviewContent.value.length > 0 || outlineText.value.length > 0
  const stillLoading = overviewLoading.value || outlineLoading.value
  return hasContent && !stillLoading
})

// ── overview 状态 ──
const overviewContent = ref('')
const keyTakeaways = ref<string[]>([])
const overviewLoading = ref(false)
const overviewError = ref(false)
const overviewDone = ref(false)
const overviewReconnected = ref(false)

// ── outline 状态 ──
const outlineText = ref('')
const outlineLoading = ref(false)
const outlineError = ref(false)
const outlineDone = ref(false)

// ── overview 流式 JSON 帧类型（内联自 AIOverview.vue）──
type OverviewSocketData =
  | {
      type: 'progress' | 'done'
      data: {
        overview?: string
        key_takeaways?: string[]
        tags?: { id: number; name: string }[]
        tag?: { id: number; name: string }
        done?: boolean
        id?: number
      }
    }
  | {
      type: 'error'
      message: string
    }

// 解析后端拼接的多段 JSON（内联自 AIOverview.vue 的 parseConcatenatedJson）
const parseConcatenatedJson = (inputString: string): OverviewSocketData[] => {
  const trimmedString = inputString.trim()
  if (!trimmedString) {
    return []
  }

  const parts = trimmedString.split('}\n{')
  const fixedParts = parts.map((part, index) => {
    if (index === 0 && parts.length > 1) {
      return part + '}'
    } else if (index === parts.length - 1 && parts.length > 1) {
      return '{' + part
    } else if (parts.length > 1) {
      return '{' + part + '}'
    }

    return part
  })

  return fixedParts.map(str => JSON.parse(str)) as OverviewSocketData[]
}

// overview 加载完成后的收尾：内容为空则自动重试一次，再为空则报错
const settleOverviewAfterDone = () => {
  overviewLoading.value = false
  overviewDone.value = true

  if (overviewContent.value.length === 0) {
    if (!overviewReconnected.value) {
      overviewReconnected.value = true
      overviewDone.value = false
      loadOverview()
    } else {
      overviewError.value = true
    }
  }
}

const loadOverview = async () => {
  if (overviewLoading.value) {
    return
  }

  overviewLoading.value = true
  overviewError.value = false

  try {
    const callBack = await request().stream({
      url: RESTMethodPath.BOOKMARK_OVERVIEW,
      method: RequestMethodType.post,
      body: {
        ...(props.bookmarkId ? { bookmark_id: props.bookmarkId } : undefined),
        ...(props.shareCode ? { share_code: props.shareCode } : undefined),
        ...(props.bookmarkUid ? { bookmark_uid: props.bookmarkUid } : undefined),
        force: false
      }
    })

    if (!callBack) {
      overviewLoading.value = false
      overviewError.value = true
      return
    }

    let errorCacheText = ''

    callBack((text: string, isDone: boolean) => {
      // 空文本 + done：done 帧，无新内容
      if (text.length === 0 && isDone) {
        settleOverviewAfterDone()
        return
      }

      let parsedJsons: OverviewSocketData[] = []
      try {
        parsedJsons = parseConcatenatedJson(errorCacheText + text)
        errorCacheText = ''
      } catch {
        // JSON 跨块未闭合，缓存等待下一块拼接
        errorCacheText = text
        if (isDone) {
          settleOverviewAfterDone()
        }
        return
      }

      for (const res of parsedJsons) {
        if (res.type === 'error') {
          // error 帧按 done + 空内容处理，触发自动重试
          settleOverviewAfterDone()
          return
        } else if (res.type === 'done' || 'done' in res.data) {
          settleOverviewAfterDone()
          return
        } else if (res.data.overview !== undefined) {
          // overview 覆盖最新值（非追加）
          overviewContent.value = res.data.overview
          overviewLoading.value = false
        } else if (res.data.key_takeaways) {
          keyTakeaways.value = res.data.key_takeaways
        }
        // tags / tag 帧忽略
      }

      if (isDone) {
        settleOverviewAfterDone()
      }
    })
  } catch {
    overviewLoading.value = false
    overviewError.value = true
  }
}

const loadOutline = async () => {
  if (outlineLoading.value) {
    return
  }

  outlineLoading.value = true
  outlineError.value = false

  try {
    // 先 GET 列表，有缓存直接展示
    const list = await request().get<SummaryItemModel[]>({
      url: RESTMethodPath.BOOKMARK_AI_SUMMARIES_LIST,
      query: {
        ...(props.bookmarkId ? { bookmark_id: props.bookmarkId } : undefined),
        ...(props.shareCode ? { share_code: props.shareCode } : undefined),
        ...(props.bookmarkUid ? { bookmark_uid: props.bookmarkUid } : undefined)
      }
    })

    if (list && list.length > 0) {
      const selfSummary = list.find(item => item.is_self) ?? list[0]!
      outlineText.value = processOutlineAnchors(extractMarkdownFromText(selfSummary.content) || '')
      outlineLoading.value = false
      outlineDone.value = true
      return
    }

    // 无缓存，POST 流式生成
    const callBack = await request().stream({
      url: RESTMethodPath.BOOKMARK_AI_SUMMARIES,
      method: RequestMethodType.post,
      body: {
        ...(props.bookmarkId ? { bm_id: props.bookmarkId } : undefined),
        ...(props.shareCode ? { share_code: props.shareCode } : undefined),
        ...(props.bookmarkUid ? { bookmark_uid: props.bookmarkUid } : undefined),
        force: false
      }
    })

    if (!callBack) {
      outlineLoading.value = false
      outlineError.value = true
      return
    }

    let result = ''
    callBack((text: string, isDone: boolean) => {
      result += text
      outlineText.value = processOutlineAnchors(extractMarkdownFromText(result) || '')
      outlineLoading.value = outlineText.value.length === 0
      if (isDone) {
        outlineLoading.value = false
        outlineDone.value = true
        if (outlineText.value.length === 0) {
          outlineError.value = true
        }
      }
    })
  } catch {
    outlineLoading.value = false
    outlineError.value = true
  }
}

// isAppeared 变为 true 时，overview 与 outline 并发自动加载（互不阻塞）
watch(
  () => props.isAppeared,
  value => {
    if (!value) {
      return
    }

    if (!overviewDone.value && !overviewLoading.value) {
      loadOverview()
    }

    if (!outlineDone.value && !outlineLoading.value) {
      // 已带默认 outline 则直接用，不再请求接口
      if (props.defaultOutline) {
        outlineText.value = processOutlineAnchors(extractMarkdownFromText(props.defaultOutline) || props.defaultOutline)
        outlineDone.value = true
      } else {
        loadOutline()
      }
    }
  },
  {
    immediate: true
  }
)
</script>

<style lang="scss" scoped>
.snapshot-ai-panel {
  --style: px-24px py-24px flex flex-col;
}

.panel-overview-label {
  --style: text-(13px accent) font-500 mb-10px;
}

// 全文解析标题：flex 行，带 grid icon，对齐 demo .panel-action
.panel-outline-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  font-size: 13px;
  color: var(--slax-accent);
  font-weight: 500;

  svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
}

.panel-overview-text {
  // 纯文本展示，对齐 snapshot demo 的 .panel-summary；pre-line 保留后端文本里的换行
  // 显式 font-sans，避免继承详情页标题的 serif 字体
  // line-height 用原生 CSS 倍数写法（UnoCSS attrify 的 leading-1.8 会被误解析成极小值）
  --style: font-sans text-(14px txt) mb-24px whitespace-pre-line;
  line-height: 1.8;
}

.panel-keypoints {
  --style: font-sans list-none p-0 mb-28px;

  li {
    // flex 布局让 ::before 圆点自动对齐第一行中心，不依赖硬编码 top 值
    display: flex;
    align-items: flex-start;
    font-size: 14px;
    color: var(--slax-text-muted);
    line-height: 1.6;

    &:not(:last-child) {
      --style: mb-8px;
    }

    &::before {
      content: '';
      flex-shrink: 0;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      // margin-top 让圆点垂直居中于第一行：(line-height * font-size - 圆点直径) / 2
      margin-top: calc((1em * 1.6 - 4px) / 2);
      margin-right: 12px;
      box-sizing: content-box;
      border: 1.5px solid var(--slax-accent);
      background: transparent;
    }
  }
}

.panel-divider {
  --style: h-1px bg-border mt-12px mb-24px;
}

// MarkdownText 渲染的 outline 内容样式
// 对齐 demo 的 panel-section-title / panel-outline-item / panel-outline-sub
.panel-outline-text {
  --style: text-(14px txt);
  line-height: 1.6;
  // 显式 sans，避免继承正文 serif
  font-family: var(--slax-font-sans);

  // 须带 .markdown-content
  // 提特异性，否则被覆盖

  // h1 → 章节标题，serif 18px
  :deep(.markdown-content h1) {
    font-family: var(--slax-font-serif) !important;
    font-size: 18px !important;
    font-weight: 500 !important;
    color: var(--slax-text);
    margin: 12px 0 20px !important;
    line-height: 1.4;
  }

  // h2 以下：子标题 14px
  :deep(.markdown-content h2),
  :deep(.markdown-content h3),
  :deep(.markdown-content h4),
  :deep(.markdown-content h5),
  :deep(.markdown-content h6) {
    font-family: var(--slax-font-sans) !important;
    font-size: 14px !important;
    font-weight: 400 !important;
    color: var(--slax-text);
    margin: 16px 0 8px !important;
    line-height: 1.5;
  }

  // 条目 14px/1.6，间距 10px
  // 原样式特异性高，故加 !important
  :deep(.markdown-content ul li),
  :deep(.markdown-content ol li) {
    font-family: var(--slax-font-sans) !important;
    font-size: 14px !important;
    font-weight: 400 !important;
    color: var(--slax-text-muted) !important;
    line-height: 1.6 !important;

    &:not(:first-child) {
      margin-top: 10px !important;
    }

    // 顶层实心圆点，top 随行高居中
    &::before {
      top: calc((1em * 1.6 - 4px) / 2) !important;
      background: var(--slax-text-light) !important;
      border-color: var(--slax-text-light) !important;
    }
  }

  // 嵌套列表中的每个条目与上一个条目保持 10px 间距，
  // 与顶层列表项一致，避免层级加深后间距被覆盖。
  :deep(.markdown-content ul ul li:not(:first-child)),
  :deep(.markdown-content ul ol li:not(:first-child)),
  :deep(.markdown-content ol ul li:not(:first-child)),
  :deep(.markdown-content ol ol li:not(:first-child)) {
    margin-top: 10px !important;
  }

  // 覆盖默认的 16px
  :deep(.markdown-content li > ul),
  :deep(.markdown-content li > ol) {
    margin-top: 10px !important;
  }

  // 子列表是 li 的第一个子元素时去掉 margin-top，
  // 让外层圆点与内层第一个圆点高度对齐
  :deep(.markdown-content li > ul:first-child),
  :deep(.markdown-content li > ol:first-child) {
    margin-top: 0 !important;
  }

  // 嵌套列表圆点改空心
  // 选择器更具体，压过实心规则
  :deep(.markdown-content ul ul li::before),
  :deep(.markdown-content ul ol li::before),
  :deep(.markdown-content ol ul li::before),
  :deep(.markdown-content ol ol li::before) {
    background: transparent !important;
    border: 1px solid var(--slax-text-light) !important;
  }

  // 锚点 chip 样式（对齐 demo .panel-outline-item .num）
  // MarkdownText 自身有更具体的 .slax_link 样式（bg-#16b9981f text-txt py-3px h-16px align-middle），
  // 用 !important 全量覆盖
  :deep(.slax_link) {
    display: inline-block !important;
    min-width: 20px;
    font-size: 12px !important;
    color: var(--slax-accent) !important;
    background: var(--slax-accent-bg) !important;
    padding: 1px 5px !important;
    border-radius: 3px !important;
    margin-left: 6px;
    text-decoration: none !important;
    text-align: center;
    cursor: pointer;
    // 显式锁定字体，避免继承父元素（如 h1/h2 的 Playfair serif）影响 chip 外观
    font-family: var(--slax-font-sans) !important;
    font-weight: 400 !important;
    font-style: normal !important;
    height: auto !important;
    line-height: 1.6 !important;
    vertical-align: baseline !important;

    &:hover {
      background: var(--slax-accent-bg) !important;
      opacity: 0.8;
    }
  }

  // hover 颜色覆盖 MarkdownText 的 !important 白字（深蓝灰底白字是 chat 等场景的反色态，
  // 但本面板锚点是绿色 chip，白字会看不清）。注意：.panel-outline-text 这个 class 就挂在
  // MarkdownText 根节点（即 .markdown-text 本身），故不能写 `.markdown-text .markdown-content`
  // ——那是「后代」选择器，永远匹配不到同一节点。直接从 .markdown-content 起选，并用 a.slax_link
  // 把特异性抬到 (0,5,1) 压过 MarkdownText 的 (0,5,0)。
  :deep(.markdown-content a.slax_link:hover) {
    color: var(--slax-accent) !important;
  }

  // li 内第一个子元素不加 margin-top，避免圆点标记与内容垂直错位
  :deep(li > *:first-child) {
    margin-top: 0;
  }

  :deep(.markdown-content p) {
    font-family: var(--slax-font-sans) !important;
    font-size: 14px !important;
    margin-bottom: 8px !important;
    line-height: 1.6;
  }
}

// 锚点点击后的高亮动画，:global 因为类加在组件外正文 DOM 上；E-ink 禁动画时靠静态底色兜底
// 也会加到跨段落临时插入的 <mark> 上，需重置其 UA 默认样式（黑字黄底）以跟随正文颜色
:global(.anchor-flash) {
  --anchor-flash-bg: color-mix(in srgb, var(--slax-accent) 22%, transparent);

  background-color: var(--anchor-flash-bg);
  color: inherit;
  border-radius: 4px;
  animation: anchor-flash 3s ease-out forwards;
}

@keyframes anchor-flash {
  from {
    background-color: var(--anchor-flash-bg);
  }
  to {
    background-color: transparent;
  }
}

.skeleton-row {
  // 骨架占位；颜色再淡一点
  --style: 'h-16px rounded-1 animate-pulse not-first:mt-10px';
  background: linear-gradient(to right, var(--slax-border), color-mix(in srgb, var(--slax-border) 45%, transparent));
}

.overview-loading-bottom,
.outline-loading-bottom {
  --style: mt-12px;
}

// 仅留间距，样式见 ListEndHint
.panel-end {
  --style: mt-24px select-none;
}

.overview-retry,
.outline-retry {
  --style: py-8px;

  .retry-btn {
    --style: text-(14px accent) cursor-pointer transition-opacity duration-fast;

    &:hover {
      --style: opacity-80;
    }
  }
}
</style>
