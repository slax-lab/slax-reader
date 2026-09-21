import type { MarkCommentInfo, MarkItemInfo, QuoteData } from '@slax-reader/selection/types'
import type { DwebArticleSelection } from '~/components/Article/Selection/DwebArticleSelection'
import type { SnapshotPanelId } from '~/components/Snapshot/panels'

export interface CommentPanelEvent {
  kind: 'new'
  info: MarkItemInfo
  quote: QuoteData
}

export interface CommentPanelExistingEvent {
  kind: 'existing'
  infoId: string
  info: MarkItemInfo
  // 仅菜单点「评论」时为 true，弹输入框
  compose?: boolean
}

/**
 * 划线 ↔ 评论卡片双向联动。
 * 维护 markUid/stroke.mark_uid（后端 key）→ MarkItemInfo.id（DOM data-uuid key）的映射。
 */
export function useCommentPanel({
  activePanel,
  articleSelection,
  allowAction = () => true
}: {
  activePanel: Ref<SnapshotPanelId | null>
  articleSelection: Ref<DwebArticleSelection | null>
  allowAction?: () => boolean
}) {
  const activeInfoId = ref<string | null>(null)
  const pendingSelection = ref<MarkItemInfo | null>(null)
  // 内含 DOM Range，深度解包会导致类型报错
  const pendingQuote = shallowRef<QuoteData | null>(null)
  // 给纯划线补评论的意图：true 才弹输入框
  const composeStroke = ref(false)
  // 重复点同一目标 watch 不触发
  const composerFocusTick = ref(0)
  const requestComposerFocus = () => composerFocusTick.value++

  // 维护后端 markUid → MarkItemInfo.id 映射（DOM 查询用 info.id，后端用 markUid）
  const collectComment = (map: Map<string, string>, c: MarkCommentInfo, infoId: string) => {
    if (c.markUid) map.set(c.markUid, infoId)
    for (const child of c.children ?? []) collectComment(map, child, infoId)
  }

  const markUidToInfoId = computed(() => {
    const map = new Map<string, string>()
    const infos = articleSelection.value?.markItemInfos?.value ?? []
    for (const info of infos) {
      for (const c of info.comments) collectComment(map, c, info.id)
      for (const s of info.stroke) {
        if (s.mark_uid) map.set(s.mark_uid, info.id)
      }
    }
    return map
  })

  // 通过 info.id 滚动到对应卡片并闪烁
  const focusByInfoId = (infoId: string) => {
    activeInfoId.value = infoId
    nextTick(() => {
      const card = document.querySelector(`[data-comment-info-id="${infoId}"]`) as HTMLElement
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      card?.classList.add('is-active')
      setTimeout(() => card?.classList.remove('is-active'), 1200)
    })
  }

  // 通过 info.id 闪烁正文划线
  const flashMarkByInfoId = (infoId: string) => {
    const marks = document.querySelectorAll<HTMLElement>(`slax-mark[data-uuid="${infoId}"]`)
    if (!marks.length) return
    // 即时定位，smooth 长文滚动太慢
    marks[0]?.scrollIntoView({ behavior: 'auto', block: 'center' })
    marks.forEach(mark => {
      mark.classList.remove('hl-flash')
      void mark.offsetWidth
      mark.classList.add('hl-flash')
      setTimeout(() => mark.classList.remove('hl-flash'), 5000)
    })
  }

  // 监听 slax:open-comment-panel 事件
  if (import.meta.client) {
    const onOpenCommentPanel = (e: Event) => {
      const detail = (e as CustomEvent).detail as CommentPanelEvent | CommentPanelExistingEvent
      activePanel.value = 'comment'

      if (detail.kind === 'new') {
        if (!allowAction()) return
        pendingSelection.value = detail.info
        pendingQuote.value = detail.quote
        activeInfoId.value = null
        composeStroke.value = false
        requestComposerFocus()
      } else {
        // 点划线只看列表；菜单点评论才弹输入框
        activeInfoId.value = detail.infoId
        pendingSelection.value = null
        pendingQuote.value = null
        composeStroke.value = allowAction() && detail.compose === true
        focusByInfoId(detail.infoId)
      }
    }

    onMounted(() => window.addEventListener('slax:open-comment-panel', onOpenCommentPanel))
    onUnmounted(() => window.removeEventListener('slax:open-comment-panel', onOpenCommentPanel))
  }

  return {
    activeInfoId,
    pendingSelection,
    pendingQuote,
    composeStroke,
    markUidToInfoId,
    focusByInfoId,
    flashMarkByInfoId,
    composerFocusTick,
    requestComposerFocus
  }
}
