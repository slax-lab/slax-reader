<template>
  <div>
    <SnapshotDetailLayout v-if="detail" class="bookmark-detail" :class="{ 'is-pdf': !!detail.pdf }" @close-panel="onUserPanelChange(null)">
      <template #topbar>
        <SnapshotTopBar>
          <template #left>
            <button class="app-name" @click="navigateTo('/')">
              <img src="@images/icon-logo-bookmark.png" width="22" height="22" alt="" />
              {{ $t('common.app.name') }}
            </button>
          </template>
          <template #theme-switcher>
            <ClientOnly><ThemeSwitcher /></ClientOnly>
          </template>
          <template #right>
            <SnapshotSharePopover :bookmark-uid="bookmarkUid" :can-manage-share="isOwner" :twitter-text="twitterShareText" />
            <div v-if="menuLoading" class="i-svg-spinners:90-ring w-1em text-txt"></div>
            <SnapshotMoreMenu v-else-if="moreMenuActions.length" :actions="moreMenuActions" @action="moreMenuClick" />
          </template>
        </SnapshotTopBar>
      </template>

      <BookmarkArticleLocalFirst
        v-if="detail"
        :key="detail.pdf?.document_id ?? 'title'"
        ref="bookmarkArticle"
        :detail="detail"
        :marks="marks"
        :footer-via="footerVia"
        :footer-show-via="!isOwner"
        :footer-collection="footerCollection"
        :local-first="localFirst"
        :bookmark-uuid="uuid"
        :local-ready="localReady"
        :is-owner="isOwner"
        :pdf-load-error="!!error"
        @retry-pdf="retryPdfContent"
        @screen-lock-update="screenLockUpdate"
        @chat-bot-quote="onChatBotQuote"
      />

      <template #right-edge-toolbar>
        <!-- visitor 无内容则隐藏整条侧栏 -->
        <SnapshotRightEdgeToolbar v-if="detail && sidePanels.length" :model-value="activePanel" :panel-open="activePanel !== null" :panels="sidePanels" @update:model-value="onUserPanelChange" />
      </template>

      <template #bottom-toolbar>
        <!-- owner 底栏：面板开时隐藏 -->
        <SnapshotBottomToolbar
          v-if="detail && isOwner"
          v-show="!(isH5 && activePanel)"
          :actions="bottomToolbarActions"
          :panels="sidePanels"
          :active-panel="activePanel"
          @action="bottomToolbarAction"
          @panel="onBottomPanel"
        />
        <!-- 非 owner 小屏笔记入口 -->
        <ClientOnly>
          <SnapshotMobileNotesEntry
            v-if="detail && !isOwner && isH5 && noteCount > 0"
            v-show="!activePanel"
            :count="noteCount"
            :author="noteOwner.name"
            :avatar="noteOwner.avatar"
            @open="activePanel = 'comment'"
          />
        </ClientOnly>
      </template>

      <template #side-panel>
        <SnapshotSidePanel :keyboard-aware="!!detail?.pdf" v-if="detail" :active-tab="activePanel" :panels="sidePanels" :shortcut="sidePanelShortcut" @update:active-tab="onUserPanelChange($event)">
          <template #ai>
            <ClientOnly>
              <!-- overview 仅 owner；outline 用 SSR 数据 -->
              <p v-if="detail.pdf && detail.pdf.text_status !== 'ready'" class="pdf-ai-unavailable" role="status">{{ $t(`pdf.text_${detail.pdf.text_status}`) }}</p>
              <SnapshotAIPanel v-else :pdf="!!detail.pdf" @find-quote="findQuote"
                :bookmark-uid="bookmarkUid"
                :default-outline="detail.outline"
                :overview-enabled="isOwner"
                :is-appeared="activePanel === 'ai'"
                @dismiss="activePanel = null"
              />
            </ClientOnly>
          </template>
          <template #transcript>
            <ClientOnly>
              <SnapshotTranscriptPanel :cues="youtubeCues" />
            </ClientOnly>
          </template>
          <template #chat>
            <!-- Chat 仅 owner，组件不挂载 -->
            <p v-if="detail.pdf && detail.pdf.text_status !== 'ready'" class="pdf-ai-unavailable" role="status">{{ $t(`pdf.text_${detail.pdf.text_status}`) }}</p>
            <SnapshotChatPanel
              v-if="isOwner && !isSubscriptionExpired && (!detail.pdf || detail.pdf.text_status === 'ready')"
              ref="chatbot"
              :bookmark-uid="bookmarkUid"
              :is-appeared="activePanel === 'chat'"
              @dismiss="activePanel = null"
              @find-quote="findQuote"
            />
          </template>
          <template #comment>
            <ClientOnly>
              <div class="comment-panel-wrap">
                <SnapshotCommentList
                  :infos="commentInfos"
                  :active-info-id="activeInfoId"
                  :allow-action="canActOnMarks"
                  :allow-reply="canReplyToMarks"
                  :allow-delete-own-reply="!isOwner"
                  :allow-unhighlight="canActOnMarks"
                  :user-list="marks?.user_list"
                  @card-click="onCommentCardClick"
                  @reply="onCommentReply"
                  @reply-stroke="onReplyStroke"
                  @cancel-highlight="onCancelHighlight"
                  @delete-comment="onDeleteComment"
                />
                <SnapshotCommentComposer
                  :allow-action="canActOnMarks"
                  :allow-reply="canReplyToMarks"
                  :article-selection="bookmarkArticleSelection"
                  :pending-selection="pendingSelection"
                  :pending-quote="pendingQuote"
                  :active-info-id="activeInfoId"
                  :infos="commentInfos"
                  :reply-to-uid="replyToUid"
                  :compose-stroke="composeStroke"
                  :focus-tick="composerFocusTick"
                  @sent="onCommentSent"
                  @cancel-reply="onCancelReply"
                />
              </div>
            </ClientOnly>
          </template>
        </SnapshotSidePanel>
      </template>
    </SnapshotDetailLayout>

    <div v-else-if="error" class="error">
      <p>{{ error.statusCode === 404 ? $t('page.bookmarks_detail.error_not_found') : $t('page.bookmarks_detail.error_generic') }}</p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import BookmarkArticleLocalFirst from '@/components/Article/BookmarkArticleLocalFirst.vue'
import SnapshotMobileNotesEntry from '@/components/Snapshot/SnapshotMobileNotesEntry.vue'
import ThemeSwitcher from '~/components/global/ThemeSwitcher.vue'
import SnapshotDetailLayout from '~/components/Layouts/SnapshotDetailLayout.vue'
import SnapshotSidePanel from '~/components/Layouts/SnapshotSidePanel.vue'
import SnapshotAIPanel from '~/components/Snapshot/SnapshotAIPanel.vue'
import SnapshotBottomToolbar, { type BottomToolbarAction } from '~/components/Snapshot/SnapshotBottomToolbar.vue'
import SnapshotChatPanel from '~/components/Snapshot/SnapshotChatPanel.vue'
import SnapshotCommentComposer from '~/components/Snapshot/SnapshotCommentComposer.vue'
import SnapshotCommentList from '~/components/Snapshot/SnapshotCommentList.vue'
import SnapshotMoreMenu, { type MoreMenuAction } from '~/components/Snapshot/SnapshotMoreMenu.vue'
import SnapshotRightEdgeToolbar from '~/components/Snapshot/SnapshotRightEdgeToolbar.vue'
import SnapshotSharePopover from '~/components/Snapshot/SnapshotSharePopover.vue'
import SnapshotTopBar from '~/components/Snapshot/SnapshotTopBar.vue'
import SnapshotTranscriptPanel from '~/components/Snapshot/SnapshotTranscriptPanel.vue'

import { eventLog } from '@/utils/analytics'
import { extractFirstContentImage } from '@/utils/ogImage'
import { sortBookmarkTags } from '@/utils/tags'

import { useLocalBookmarks } from '@/composables/bookmark/useLocalBookmarks'
import { useLocalMarks } from '@/composables/bookmark/useLocalMarks'
import { useReadingPosition } from '@/composables/useReadingPosition'
import { useSidePanelPreference } from '@/composables/useSidePanelPreference'
import type { MarkDetail, SnapshotBookmarkDetail, SnapshotMetadata } from '@commons/frontend-types/models'
import { isClient, isServer } from '@commons/frontend-utils/is'
import { extractHTMLTextContent } from '@commons/frontend-utils/parse'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { runArticleSsrProcessors } from '~/components/Article/processors/ssr-runner'
import type { QuoteData } from '~/components/Chat/type'
import CursorToast from '~/components/CursorToast'
import { showLoginModal } from '~/components/Modal'
import type { SnapshotPanelId } from '~/components/Snapshot/panels'
import Toast, { ToastType } from '~/components/Toast'
import { useBookmark } from '~/composables/bookmark/useBookmark'
import { useCommentPanel } from '~/composables/useCommentPanel'
import { useSnapshotLayout } from '~/composables/useSnapshotLayout'
import type { IconKey } from '~/icons/registry'
import { useUserStore } from '~/stores/user'
import { pdfTitlePreview } from '~/utils/pdfPreview'
import type { PdfTitlePreview } from '~/utils/pdfPreview'

const { t, locale } = useI18n()
const route = useRoute()
const uuid = String(route.params.id)

const requestUrl = useRequestURL()
const selfUrl = `${requestUrl.origin}${requestUrl.pathname}`

const ogLocale = locale.value === 'zh' ? 'zh_CN' : 'en_US'
const TWITTER_SITE = '@SlaxReader'

// 快照页副本：noindex 防重复内容
// follow 跟踪合集链接，noarchive 禁缓存
useRobotsRule('noindex, follow, noarchive')

let contentResponseHeaders = new Headers()
let articleProcessDuration: number | undefined
const contentRequestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const contentRequestEvent = import.meta.server ? useRequestEvent() : undefined
const fetchContent = useRequestFetch()

const { data: pageData, error, refresh: refreshContent } = await useAsyncData(`content-${uuid}`, async () => {
  const res = await fetchContent<{ metadata: SnapshotMetadata; body: string | null }>(`/api/content/${uuid}`, {
    headers: contentRequestHeaders,
    onResponse({ response }) {
      contentResponseHeaders = new Headers(response.headers)
    }
  })

  if (import.meta.server && res?.body) {
    const articleProcessStartedAt = performance.now()
    res.body = await runArticleSsrProcessors(res.body)
    articleProcessDuration = performance.now() - articleProcessStartedAt
  }

  if (import.meta.server) {
    const title = pdfTitlePreview(res.metadata)
    if (title) {
      const event = contentRequestEvent
      if (event) {
        event.context.__isOwner = res.metadata.role === 'owner'
        event.context.__ownerUid = res.metadata.user_id == null ? '' : String(res.metadata.user_id)
      }
      // Only the title/type placeholder is serialized for PDF hydration.
      return { metadata: title as SnapshotMetadata, body: null }
    }
  }

  return res
})

const clientReady = import.meta.client ? new Promise<void>(resolve => onNuxtReady(resolve)) : undefined
const pdfPlaceholder = ref<PdfTitlePreview>()
watch(() => pageData.value?.metadata, metadata => {
  if (metadata) pdfPlaceholder.value = pdfTitlePreview(metadata)
}, { immediate: true })

let pdfTextPoll: ReturnType<typeof setTimeout> | undefined
let pdfTextPollCount = 0
watch(() => pageData.value?.metadata?.pdf?.text_status, status => {
  clearTimeout(pdfTextPoll)
  if (import.meta.client && status === 'pending' && pdfTextPollCount++ < 100) {
    pdfTextPoll = setTimeout(async () => {
      await refreshContent().catch(() => {})
      if (pageData.value?.metadata?.pdf?.text_status === 'pending' && pdfTextPollCount++ < 100) schedulePdfTextPoll()
    }, 3000)
  }
}, { immediate: true })
function schedulePdfTextPoll() {
  pdfTextPoll = setTimeout(async () => {
    await refreshContent().catch(() => {})
    if (pageData.value?.metadata?.pdf?.text_status === 'pending' && pdfTextPollCount++ < 100) schedulePdfTextPoll()
  }, 3000)
}
onBeforeUnmount(() => clearTimeout(pdfTextPoll))

if (import.meta.server && useRuntimeConfig().public.slaxEnv !== 'production') {
  const appendServerTiming = (value: string) => {
    const serverTiming = useResponseHeader('server-timing')
    serverTiming.value = serverTiming.value ? `${serverTiming.value}, ${value}` : value
  }

  const contentServerTiming = contentResponseHeaders.get('server-timing')
  if (contentServerTiming) appendServerTiming(contentServerTiming)

  if (articleProcessDuration !== undefined) {
    appendServerTiming(`front_article-process;dur=${Math.max(0, articleProcessDuration).toFixed(1)}`)
  }
}

if (error.value) {
  throw createError({
    statusCode: (error.value as { statusCode?: number }).statusCode ?? 500,
    statusMessage: 'Content unavailable',
    fatal: true
  })
}

const restMarks = ref<MarkDetail>({ mark_list: [], user_list: {} })

const localFirst = ref(false)
const localReady = ref(false)
const isOwner = computed(() => (pageData.value?.metadata as { role?: string } | undefined)?.role === 'owner')
const local = import.meta.client && isLocalFirstEnabled() ? useLocalBookmarks() : null
const localMarksQuery = local ? useLocalMarks().watchMarkDetail(uuid, localFirst) : null
const canActOnMarks = computed(() => isOwner.value)
const localRow = local ? local.watchDetail(uuid, localFirst) : null

useReadingPosition(uuid, {
  enabled: () => localFirst.value && !detail.value?.pdf,
  ready: () => localReady.value,
  skipRestore: () => !!route.query.highlight,
  load: () => local?.getReadingPosition(uuid).then(r => (r ? { index: r.anchor_index, ratio: r.anchor_ratio, percent: r.percent } : null)) ?? Promise.resolve(null),
  save: anchor => local?.setReadingPosition(uuid, anchor),
  clear: () => local?.clearReadingPosition(uuid)
})

const marks = computed<MarkDetail>(() => {
  if (localFirst.value && localMarksQuery && !localMarksQuery.isLoading.value) return localMarksQuery.marks.value
  return restMarks.value
})

// 窄字段+值短路：archive/star
// 写库时 detail 不翻新，免崩溃
const localHasRow = computed(() => localFirst.value && !!localRow?.row.value)
const localTitle = computed<string | null>(() => (localFirst.value ? (localRow?.row.value?.m_title ?? null) : null))
const localAlias = computed<string | null>(() => (localFirst.value ? (localRow?.row.value?.alias_title ?? null) : null))

const detail = computed<SnapshotBookmarkDetail | null>(() => {
  const meta = (pageData.value?.metadata ?? pdfPlaceholder.value) as SnapshotMetadata | undefined
  if (!meta) return null

  const base = {
    ...meta,
    tags: meta.tags ? sortBookmarkTags(meta.tags) : meta.tags,
    content: pageData.value?.body ?? '',
    marks: marks.value
  } as SnapshotBookmarkDetail
  if (localHasRow.value) {
    return {
      ...base,
      title: localTitle.value ?? base.title,
      alias_title: localAlias.value ?? base.alias_title
    }
  }
  return base
})

// bookmark_uid 即 user_bookmark_uuid
const bookmarkUid = computed(() => detail.value?.bookmark_uuid ?? '')

if (import.meta.server) {
  const reqEvent = useRequestEvent()
  if (reqEvent) {
    const metadata = pageData.value?.metadata as { role?: string; user_id?: number } | undefined
    reqEvent.context.__isOwner ??= metadata?.role === 'owner'
    reqEvent.context.__ownerUid ??= metadata?.user_id == null ? '' : String(metadata.user_id)
  }
}

// footer 合集归属：所属开启中合集
// 无则 null，SSR 首屏即带
const footerCollection = computed(() => detail.value?.collection ?? null)

// footer 署名：无昵称则回退
const footerVia = computed(() => {
  // 暂时回退为默认署名
  // 恢复昵称改回下方注释
  // const info = detail.value?.user_info
  // return info?.show_userinfo && info?.nick_name ? info.nick_name : ''
  return ''
})

const bookmarkArticle = ref<InstanceType<typeof BookmarkArticleLocalFirst>>()
const chatbot = ref<InstanceType<typeof SnapshotChatPanel>>()

const bookmarkArticleSelection = computed(() => bookmarkArticle.value?.articleSelection ?? null)
const commentInfos = computed(() => bookmarkArticleSelection.value?.markItemInfos?.value ?? [])

const hasLiveComment = (comments: CommentNode[]): boolean => comments.some(comment => !comment.isDeleted || hasLiveComment(comment.children ?? []))
const canReplyToMarks = computed(() => isOwner.value || commentInfos.value.some(info => hasLiveComment(info.comments)))

// 笔记数，与评论徽标同源
type CommentNode = (typeof commentInfos.value)[number]['comments'][number]
const noteCount = computed(() => {
  const countComments = (list: CommentNode[]): number => list.reduce((sum, c) => sum + (c.isDeleted ? 0 : 1) + countComments(c.children ?? []), 0)
  return commentInfos.value.reduce((acc, info) => {
    const n = countComments(info.comments)
    if (n === 0 && info.stroke.length > 0) return acc + 1
    return acc + n
  }, 0)
})

// 作者：优先 user_info
// 回退 marks.user_list
const noteOwner = computed(() => {
  const info = detail.value?.user_info
  const uid = detail.value?.user_id
  const fromList = uid != null ? marks.value?.user_list?.[String(uid)] : undefined
  return {
    name: info?.show_userinfo && info?.nick_name ? info.nick_name : (fromList?.username ?? ''),
    avatar: info?.show_userinfo && info?.avatar ? info.avatar : (fromList?.avatar ?? '')
  }
})

const loadMarks = async () => {
  if (!bookmarkUid.value) return
  try {
    // 免登录 mark_list 接口
    const res = await request().get<MarkDetail>({
      url: RESTMethodPath.SHARE_BOOKMARK_MARK_LIST,
      query: { bookmark_uid: bookmarkUid.value }
    })
    if (res) restMarks.value = res
  } catch {
    restMarks.value = { mark_list: [], user_list: {} }
  }
}

// SSR 缓存导致 first_comment 可能过期，
// 客户端从 marks 实时派生覆盖
const ownerFirstComment = computed(() => {
  const ownerId = detail.value?.user_id
  if (!ownerId) return detail.value?.first_comment?.trim() || ''
  const ownerMark = marks.value?.mark_list?.find(m => !m.is_deleted && m.user_id === ownerId && m.comment?.trim())
  if (ownerMark) return ownerMark.comment.trim()
  return ''
})

// 初始任务完成闸门
const tasksReady = ref(false)
// 同步卡住兜底
const forceDecide = ref(false)

const { isSubscriptionExpired, showAnalyzed, showChatbot, chatBotQuote, showFeedback, screenLockUpdate } = useBookmark({
  chatbot,
  typeOptions: () => ({
    type: BookmarkType.Snapshot,
    title: detail.value?.title || '',
    bookmarkUid: bookmarkUid.value,
    targetUrl: detail.value?.target_url
  }),
  initialRequestTask: initializeClientDetail,
  // 就绪后决定初始侧栏
  initialTasksCompleted: () => {
    if (!isClient) return
    tasksReady.value = true
    nextTick(() => decideInitialPanel())
    setTimeout(() => {
      forceDecide.value = true
      decideInitialPanel()
    }, 5000)
  }
})

async function initializeClientDetail() {
  if (!isClient) return
  const userStore = useUserStore()
  if (pageData.value?.metadata.type === 'pdf' && !pageData.value.metadata.pdf) {
    await clientReady
    await refreshContent()
    if (error.value) return
  }
  // 划线/评论归属依赖真实 userId
  // upstream 取不到，这里刷新兜底
  if (userStore.isLogin && !userStore.userInfo) {
    try {
      await userStore.refreshUserInfo()
    } catch (e) {
      console.error('[b] load user failed:', e)
    }
  }
  if (local) {
    try {
      if (isOwner.value && (await local.exists(uuid))) localFirst.value = true
    } catch (e) {
      console.error('[b] local-first takeover failed:', e)
    }
  }
  localReady.value = true
  if (!localFirst.value) await loadMarks()
}
async function retryPdfContent() {
  await refreshContent()
  if (!error.value) await initializeClientDetail()
}

// visitor：AI 看 outline，评论看 marks
const hasOutline = computed(() => !!detail.value?.outline?.trim())
// Pro = 订阅未过期；owner+Pro 无条件展开 AI（outline 交由面板接口补齐）
const isPro = computed(() => !isSubscriptionExpired.value)
// 排除已删除的标记
const hasMarks = computed(() => marks.value?.mark_list?.some(m => !m.is_deleted) ?? false)

const isYoutube = computed(() => /<youtube-player\b/i.test(detail.value?.content ?? ''))
const youtubeCues = computed<{ t: number; text: string }[]>(() => {
  const content = detail.value?.content
  if (!content || typeof DOMParser === 'undefined') return []
  const el = new DOMParser().parseFromString(content, 'text/html').querySelector('youtube-player')
  const raw = el?.getAttribute('data-cues')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
})

const sidePanels = computed<SnapshotPanelId[]>(() => {
  if (isOwner.value) return isYoutube.value ? ['ai', 'transcript', 'chat', 'comment'] : ['ai', 'chat', 'comment']
  const panels: SnapshotPanelId[] = []
  if (hasOutline.value) panels.push('ai')
  if (isYoutube.value) panels.push('transcript')
  if (hasMarks.value) panels.push('comment')
  return panels
})

const activePanel = ref<SnapshotPanelId | null>(null)
// 收起后用于恢复的面板
const lastOpenedPanel = ref<SnapshotPanelId | null>(null)
// isH5 单一来源（≤768）
const { panelOpen, panelWidth, isH5 } = useSnapshotLayout()
// 本地偏好：收起过就不再自动展开，手动打开就恢复；没记录时看窗口够不够宽
const { shouldAutoOpen, markOpened, markClosed } = useSidePanelPreference()

// 有划线→评论
// 否则 owner+Pro 直开 AI；visitor/非 Pro 仅有 outline 才展开
const autoDecided = ref(false)
const decideInitialPanel = () => {
  if (autoDecided.value || !tasksReady.value || isH5.value) return // 待初始任务完成
  if (!forceDecide.value && localFirst.value && localMarksQuery?.isLoading.value) return // 划线未就绪则等
  autoDecided.value = true
  // 用户收起过，或窗口放不下正文 + 面板，就不自动展开
  if (!shouldAutoOpen(window.innerWidth, panelWidth.value)) return
  if (isYoutube.value) {
    activePanel.value = 'transcript'
  } else if (hasMarks.value) {
    activePanel.value = 'comment'
  } else if (isOwner.value && isPro.value) {
    activePanel.value = 'ai'
  } else if (hasOutline.value) {
    activePanel.value = 'ai'
  }
}
// 划线加载完补判
if (localMarksQuery) {
  watch(
    () => localMarksQuery.isLoading.value,
    () => decideInitialPanel()
  )
}

watch(activePanel, (val, oldVal) => {
  // AI/Chat 过登录+订阅校验
  // 有 outline 或 owner+Pro 则免校验直开
  if (val === 'ai' && !hasOutline.value && !(isOwner.value && isPro.value) && !showAnalyzed()) {
    activePanel.value = oldVal ?? null
    return
  }
  if (val === 'chat' && !showChatbot()) {
    activePanel.value = oldVal ?? null
    return
  }
  panelOpen.value = val !== null
  if (val !== null) lastOpenedPanel.value = val
})

// 切换侧栏，对齐扩展端
const isMac = isClient && /Mac/i.test(navigator.platform || navigator.userAgent)
// 挂载后再按平台改写，避免 hydration 不一致
const sidePanelShortcut = ref('Ctrl + Shift + Z')
onMounted(() => {
  if (isMac) sidePanelShortcut.value = '⌃ + ⇧ + Z'
})
// 用户主动开关面板走这里，记到本地偏好；程序性的开关（登录校验回退、小屏收起）不记
const onUserPanelChange = (id: SnapshotPanelId | null) => {
  activePanel.value = id
  if (isH5.value) return
  if (id === null) markClosed()
  else markOpened()
}
const toggleSidePanel = () => {
  if (!sidePanels.value.length) return
  if (activePanel.value !== null) {
    onUserPanelChange(null)
    return
  }
  const restore = lastOpenedPanel.value && sidePanels.value.includes(lastOpenedPanel.value) ? lastOpenedPanel.value : sidePanels.value[0]
  onUserPanelChange(restore ?? null)
}
onKeyStroke(['z', 'Z'], e => {
  const ctrlFire = (e.ctrlKey && !isMac) || ((e.ctrlKey || e.metaKey) && isMac)
  if (!ctrlFire || !e.shiftKey) return
  // 输入框放行原生 redo
  const el = e.target as HTMLElement | null
  if (el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
  if (!sidePanels.value.length) return
  e.preventDefault()
  toggleSidePanel()
})

// 小屏点击面板：切换 activePanel
const onBottomPanel = (id: SnapshotPanelId) => {
  activePanel.value = activePanel.value === id ? null : id
}

// panelOpen 为共享 ref，需手动复位
onMounted(() => {
  panelOpen.value = false

  // 埋点：bookmark_opened
  if (isClient) {
    const openedFrom = consumeEventEntry(['bookmarks', 'inbox_collection', 'search_result', 'direct'] as const, 'direct')
    eventLog({
      event_name: 'bookmark_opened',
      properties: {
        bookmark_id: detail.value?.bookmark_uuid || uuid,
        url_domain: (() => {
          try {
            return new URL(detail.value?.target_url || '').hostname
          } catch {
            return detail.value?.host_url || ''
          }
        })(),
        source: 'web_button',
        content_type: detail.value?.type === 'shortcut' ? 'url_only' : 'full_content',
        opened_from: openedFrom
      }
    })
  }
})

// 评论面板联动
const { activeInfoId, pendingSelection, pendingQuote, composeStroke, focusByInfoId, flashMarkByInfoId, composerFocusTick, requestComposerFocus } = useCommentPanel({
  activePanel,
  articleSelection: bookmarkArticleSelection,
  allowAction: () => canActOnMarks.value
})

const replyToUid = ref<string | null>(null)

const onCommentCardClick = (infoId: string) => {
  // 小屏：评论面板以 sheet 覆盖正文，点卡片要跳到正文划线，
  // 先收起评论列表再闪烁，否则高亮被面板挡住看不到
  if (isH5.value) {
    activePanel.value = null
    nextTick(() => flashMarkByInfoId(infoId))
    return
  }
  flashMarkByInfoId(infoId)
  requestComposerFocus()
}

const findCommentByUid = (comments: CommentNode[], markUid: string): CommentNode | null => {
  for (const comment of comments) {
    if (comment.markUid === markUid) return comment
    const child = findCommentByUid(comment.children ?? [], markUid)
    if (child) return child
  }
  return null
}

const onCommentReply = (comment: { markUid: string }) => {
  if (!canReplyToMarks.value || !comment.markUid) return
  const userStore = useUserStore()
  if (!userStore.isLogin) {
    showLoginModal({ redirect: location.href })
    return
  }

  const infos = bookmarkArticleSelection.value?.markItemInfos?.value ?? []
  for (const info of infos) {
    const found = findCommentByUid(info.comments, comment.markUid)
    if (found && !found.isDeleted) {
      activeInfoId.value = info.id
      replyToUid.value = comment.markUid
      pendingSelection.value = null
      pendingQuote.value = null
      composeStroke.value = false
      requestComposerFocus()
      break
    }
  }
}

const onReplyStroke = (infoId: string) => {
  if (!canActOnMarks.value) return
  activeInfoId.value = infoId
  replyToUid.value = null
  // 显式补评论意图，才弹输入框
  composeStroke.value = true
  requestComposerFocus()
}

// 取消划线，保留评论
const onCancelHighlight = async (infoId: string) => {
  if (!canActOnMarks.value) return
  const selection = bookmarkArticleSelection.value
  const info = selection?.markItemInfos?.value.find(i => i.id === infoId)
  if (!selection || !info) return
  try {
    await selection.deleteStroke(info)
    Toast.showToast({ text: t('common.tips.cancel_line_success'), type: ToastType.Success })
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
}

// 删除本人纯评论
const onDeleteComment = async (infoId: string, comment: { markUid: string }) => {
  const selection = bookmarkArticleSelection.value
  if (!selection || !comment.markUid) return

  if (!isOwner.value) {
    const userId = useUserStore().userInfo?.userId
    const info = selection.markItemInfos?.value.find(item => item.id === infoId)
    const target = info ? findCommentByUid(info.comments, comment.markUid) : null
    const isRootComment = info?.comments.some(root => root.markUid === comment.markUid)
    const isOwnReply = !!userId && !isRootComment && target?.userId === userId && !target.isDeleted
    if (!isOwnReply) return
  }

  try {
    await selection.deleteComment(infoId, comment.markUid)
    Toast.showToast({ text: t('common.tips.delete_comment_success'), type: ToastType.Success })
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
}

const onCommentSent = (infoId: string) => {
  focusByInfoId(infoId)
}

const onCancelReply = () => {
  pendingSelection.value = null
  pendingQuote.value = null
  activeInfoId.value = null
  replyToUid.value = null
  composeStroke.value = false
}

// 选区菜单点 chat：侧栏可能停在别的 tab，
// 先切到 chat 再塞引用
const onChatBotQuote = (quote: QuoteData) => {
  if (activePanel.value !== 'chat') activePanel.value = 'chat'
  chatBotQuote(quote)
}

const findQuote = (quote: QuoteData) => {
  bookmarkArticle.value?.findQuote(quote)
}

const editTitleIcon: IconKey = 'snapshot.edit-title'
const feedbackIcon: IconKey = 'snapshot.feedback'

const menuLoading = ref(false)

// 标题与反馈均仅 owner 可见
const moreMenuActions = computed<MoreMenuAction[]>(() => {
  const actions: MoreMenuAction[] = []
  if (isOwner.value) {
    actions.push({ id: 'edit_title', label: t('common.operate.edit_title'), icon: editTitleIcon })
    actions.push({ id: 'feedback', label: t('common.operate.report_issue'), icon: feedbackIcon })
  }
  return actions
})

const moreMenuClick = (action: MoreMenuAction) => {
  if (action.id === 'feedback') showFeedback()
  else if (action.id === 'edit_title') editTitle()
}

// 修改标题：内联编辑
const editTitle = () => {
  const titleEl = document.querySelector('.bookmark-detail .article-title') as HTMLElement | null
  if (!titleEl) return

  // 编辑基准：完整标题，alias 优先
  // CSS 截断仅视觉，内容仍完整
  const fullTitle = detail.value?.alias_title || detail.value?.title || ''

  titleEl.setAttribute('contenteditable', 'true')
  titleEl.focus()
  const range = document.createRange()
  range.selectNodeContents(titleEl)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      titleEl.blur()
    }
    if (ev.key === 'Escape') {
      titleEl.textContent = fullTitle
      titleEl.blur()
    }
  }

  const finish = async () => {
    titleEl.removeAttribute('contenteditable')
    titleEl.removeEventListener('blur', finish)
    titleEl.removeEventListener('keydown', onKey)
    const newTitle = titleEl.textContent?.trim() || ''
    if (newTitle && newTitle !== fullTitle && bookmarkUid.value) {
      menuLoading.value = true
      try {
        if (localFirst.value && local) {
          await local.setAliasTitle(uuid, newTitle)
        } else {
          await request().post({ url: RESTMethodPath.BOOKMARK_ALIAS_TITLE, body: { bookmark_uid: bookmarkUid.value, alias_title: newTitle } })
          const meta = pageData.value?.metadata as SnapshotMetadata | undefined
          if (meta) {
            meta.title = newTitle
            meta.alias_title = newTitle
          }
        }
      } catch {
        titleEl.textContent = fullTitle
        Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
      } finally {
        menuLoading.value = false
      }
    } else {
      // 无改动或标题为空：恢复完整标题展示
      titleEl.textContent = fullTitle
    }
  }

  titleEl.addEventListener('blur', finish)
  titleEl.addEventListener('keydown', onKey)
}

// LF 用 localRow，REST 用 ref
// 都不进 detail，避免重渲染
const restArchived = ref<'inbox' | 'archive' | 'later'>('inbox')
const restStarred = ref<'star' | 'unstar'>('unstar')
watch(
  detail,
  d => {
    if (d) {
      restArchived.value = d.archived ?? 'inbox'
      restStarred.value = d.starred ?? 'unstar'
    }
  },
  { immediate: true }
)

const localArchived = computed<'inbox' | 'archive'>(() => (localRow?.row.value?.archive_status === 1 ? 'archive' : 'inbox'))
const localStarred = computed<'star' | 'unstar'>(() => (localRow?.row.value?.is_starred === 1 ? 'star' : 'unstar'))

const isArchived = computed(() => (localFirst.value ? localArchived.value !== 'inbox' : restArchived.value !== 'inbox'))
const isStarred = computed(() => (localFirst.value ? localStarred.value === 'star' : restStarred.value === 'star'))

const archiveIcon: IconKey = 'bookmark-action.archive'
const archiveIconOn: IconKey = 'bookmark-action.archive-active'
const starIcon: IconKey = 'bookmark-action.star'
const starIconOn: IconKey = 'bookmark-action.star-active'

const bottomToolbarActions = computed<BottomToolbarAction[]>(() => [
  // 归档后文案变「已归档」
  {
    id: 'archive',
    icon: isArchived.value ? archiveIconOn : archiveIcon,
    label: t(isArchived.value ? 'common.operate.archived' : 'common.operate.archive'),
    active: isArchived.value
  },
  // 加星后文案变「已加星」
  { id: 'star', icon: isStarred.value ? starIconOn : starIcon, label: t(isStarred.value ? 'common.operate.starred' : 'common.operate.star'), active: isStarred.value }
])

// 成功提示用光标 Toast，贴近按钮弹出
const showSuccessToast = (text: string, trackDom: HTMLElement | null) => {
  const baseContainer = trackDom?.closest('.bottom-toolbar') as HTMLElement | null
  if (trackDom && baseContainer) {
    CursorToast.showToast({ text, trackDom, baseContainer, type: ToastType.Success })
  } else {
    Toast.showToast({ text, type: ToastType.Success })
  }
}

const archiveBookmark = async (trackDom: HTMLElement | null) => {
  const status = isArchived.value ? 'inbox' : 'archive'
  try {
    if (localFirst.value && local) {
      await local.setArchive(uuid, status === 'archive')
    } else {
      await request().post({ url: RESTMethodPath.BOOKMARK_ARCHIVE, body: { bookmark_uid: bookmarkUid.value, status } })
      restArchived.value = status
    }
    showSuccessToast(t(status === 'archive' ? 'common.tips.archive_success' : 'common.tips.unarchive_success'), trackDom)
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
}

const starBookmark = async (trackDom: HTMLElement | null) => {
  const status = isStarred.value ? 'unstar' : 'star'
  try {
    if (localFirst.value && local) {
      await local.setStar(uuid, status === 'star')
    } else {
      await request().post({ url: RESTMethodPath.BOOKMARK_STAR, body: { bookmark_uid: bookmarkUid.value, status } })
      restStarred.value = status
    }
    showSuccessToast(t(status === 'star' ? 'common.tips.star_success' : 'common.tips.unstar_success'), trackDom)
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
}

const bottomToolbarAction = (action: BottomToolbarAction, event: MouseEvent) => {
  // 同步取按钮 DOM，await 后会失效
  const trackDom = event.currentTarget as HTMLElement | null
  if (action.id === 'archive') archiveBookmark(trackDom)
  else if (action.id === 'star') starBookmark(trackDom)
}

const twitterShareText = computed(() => {
  const m = detail.value
  if (!m) return ''
  const isPersonal = !!(m.user_info?.show_userinfo && m.user_info?.nick_name)
  if (isPersonal && ownerFirstComment.value) return ownerFirstComment.value
  return ''
})

const defineSeo = () => {
  const m = detail.value
  if (!m) return

  const title = `${m.title} - ${t('common.app.name')}`

  const isPersonal = !!(m.user_info?.show_userinfo && m.user_info?.nick_name)
  const ownerName = m.user_info?.nick_name || ''

  const bodyText = extractHTMLTextContent(m.content || '')
  const firstComment = ownerFirstComment.value
  const ogDescription = isPersonal && firstComment ? `${ownerName}：${firstComment.slice(0, 120)}` : (m.description || bodyText).slice(0, 120)

  const ogTitle = isPersonal && firstComment ? t('page.bookmarks_detail.og_title_with_notes', { title: m.title || '', author: ownerName }) : m.title

  const ogImage = m.content_cover || extractFirstContentImage(m.content || '', m.target_url) || ''

  useHead({
    titleTemplate: title,
    link: [{ rel: 'canonical', href: m.pdf?.source === 'upload' ? selfUrl : m.target_url }]
  })

  useSeoMeta({
    title,
    description: ogDescription,
    ogType: 'article',
    ogTitle,
    ogDescription,
    ogUrl: selfUrl,
    ogSiteName: t('common.app.name'),
    ogLocale,
    ...(m.published_at ? { articlePublishedTime: m.published_at } : {}),
    ...(isPersonal ? { author: ownerName, articleAuthor: [ownerName] } : {}),
    twitterTitle: ogTitle,
    twitterDescription: ogDescription,
    twitterCard: 'summary_large_image',
    twitterSite: TWITTER_SITE,
    ...(ogImage ? { ogImage, twitterImage: ogImage, ogImageAlt: m.title || '', twitterImageAlt: m.title || '' } : {})
  })

  if (isServer && !ogImage) {
    defineOgImage('Share', { title: m.title || '' })
  }

  const datePublished = m.published_at || m.created_at
  useSchemaOrg([
    defineWebPage({
      name: title,
      description: ogDescription,
      ...(datePublished ? { datePublished } : {})
    }),
    defineArticle({
      '@id': '#article',
      headline: m.title || '',
      description: ogDescription,
      ...(ogImage ? { image: ogImage } : {}),
      ...(datePublished ? { datePublished } : {}),
      ...(m.target_url ? { isBasedOn: m.target_url } : {}),
      ...(isPersonal ? { author: { name: ownerName } } : {})
    })
  ])
}

const renderServerData = () => {
  try {
    defineSeo()
  } catch (error) {
    console.error(error)
  }
}

renderServerData()
</script>

<style lang="scss" scoped>
@media (max-width: 768px) {
  .bookmark-detail.is-pdf :deep(.comment-composer-send),
  .bookmark-detail.is-pdf :deep(.comment-meta-actions button),
  .bookmark-detail.is-pdf :deep(.comment-sub-actions button),
  .bookmark-detail.is-pdf :deep(.side-panel-tab),
  .bookmark-detail.is-pdf :deep(.side-panel-close) { min-height: 44px; min-width: 44px; }
}
.pdf-ai-unavailable { padding: 24px; font-size: var(--slax-fs-aux); line-height: 1.6; color: var(--slax-text-muted); }
.bookmark-detail {
  --slax-header-height: var(--slax-header-h-snapshot);

  // 勿设 flex，会挤偏正文
  --style: w-full relative;

  .app-name {
    --style: 'flex items-center gap-10px text-brand font-serif font-500 line-height-28px cursor-pointer transition-opacity duration-fast hover:opacity-80';
    color: var(--slax-text);
    background: transparent;
    border: none;
    padding: 0;

    img {
      flex-shrink: 0;
      display: block;
    }
  }
}

.comment-panel-wrap {
  --style: h-full flex flex-col overflow-hidden;
}

.error {
  --style: fixed inset-0 flex-center select-none text-(slate lg);
}
</style>

<!-- eslint-disable-next-line vue-scoped-css/enforce-style-type -->
<style lang="scss">
html {
  --style: bg-surface-solid;
}
/* 渐变走全局 token，同列表页 */
</style>
