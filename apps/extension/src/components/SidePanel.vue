<template>
  <PanelView :show-panel="showPanel" @close="closePanel" v-if="!needHidden">
    <template #content>
      <Transition name="sidepanel">
        <div class="dark px-20px" v-show="isSummaryShowing && isSubscribed">
          <AIOverview
            v-if="bookmarkBriefInfo"
            :bookmark-brief-info="bookmarkBriefInfo"
            :bookmark-id="hasBookmarkReference ? 1 : undefined"
            :isAppeared="isSummaryShowing"
          />
          <AISummaries
            v-if="hasBookmarkReference"
            :key="`${currentUrl}:${bookmarkReferenceKey}`"
            ref="summaries"
            :bookmark-id="hasBookmarkReference ? 1 : undefined"
            :isAppeared="isSummaryShowing"
            :close-button-hidden="true"
            @dismiss="closePanel"
          />
        </div>
      </Transition>
      <Transition name="sidepanel">
        <div class="dark size-full" v-show="isChatbotShowing && isSubscribed">
          <ChatBot
            v-if="hasBookmarkReference"
            :key="`${currentUrl}:${bookmarkReferenceKey}`"
            ref="chatbot"
            :bookmark-id="hasBookmarkReference ? 1 : undefined"
            :isAppeared="isChatbotShowing"
            :close-button-hidden="true"
            @dismiss="closePanel"
            @find-quote="findQuote"
          />
        </div>
      </Transition>
      <Transition name="sidepanel">
        <div class="dark size-full" v-show="isCommentShowing">
          <ArticleCommentsView
            v-if="userInfo && articleSelection"
            :key="currentUrl"
            ref="comments"
            :selection="articleSelection"
            :isAppeared="isCommentShowing"
            :bookmark-user-id="userInfo.userId"
          />
        </div>
      </Transition>
      <SubscribePlaceholder
        v-if="!isSubscribed && (isChatbotShowing || isSummaryShowing) && bookmarkBriefInfo"
        :placeholder-style="!isChatbotShowing ? PlaceholderStyle.Summary : PlaceholderStyle.Chat"
        :bookmark-brief-info="bookmarkBriefInfo"
        :bookmark-uid="bookmarkUid ?? undefined"
      />
    </template>
    <template #tabbars>
      <div class="button-wrapper" v-for="panel in subPanelItems" :key="panel.type">
        <button @click="panelClick(panel)">
          <Transition name="opacity">
            <div class="selected-bg" v-show="panel.isSelected && panel.isSelected()"></div>
          </Transition>
          <div class="icon-wrapper">
            <div class="icon">
              <template v-if="!(panel.isSelected && panel.isSelected()) || !panel.selectedIcon">
                <img class="normal" :src="panel.icon" alt="" />
                <img class="highlighted" :src="panel.highlighedIcon" alt="" />
              </template>
              <template v-else>
                <img class="selected" :src="panel.selectedIcon" alt="" />
              </template>
            </div>
          </div>
        </button>
      </div>
    </template>
    <template #operate>
      <PanelOperate :is-star="bookmarkBriefInfo?.starred === 'star'" :is-archive="bookmarkBriefInfo?.archived === 'archive'" @action="panelClick" />
    </template>
  </PanelView>
  <template v-if="!needHidden">
    <div v-if="!isDismissed" class="edge-zone" @mouseenter="expandWebPanel" @mouseleave="scheduleCollapse" />
    <div
      v-if="!isDismissed"
      class="edge-handle"
      :class="{ hint: isHandleHinting }"
      :style="{ opacity: isHandleVisible ? 1 : 0, pointerEvents: isHandleVisible ? 'auto' : 'none' }"
      @mouseenter="expandWebPanel"
      @mouseleave="scheduleCollapse"
    />
    <div class="web-panel" :class="{ expanded: isWebPanelExpanded }" @mouseenter="cancelCollapse" @mouseleave="scheduleCollapse">
      <SidebarTips>
        <SidebarItems
          :is-summary-showing="isSummaryShowing"
          :is-chatbot-showing="isChatbotShowing"
          :is-comment-showing="isCommentShowing"
          :is-star="bookmarkBriefInfo?.starred === 'star'"
          :is-archive="bookmarkBriefInfo?.archived === 'archive'"
          @panel-item-action="panelClick"
          @more-panel-open="onMorePanelOpen"
          @more-panel-close="onMorePanelClose"
          @dismiss="onSidebarDismiss"
        />
      </SidebarTips>
    </div>
  </template>
  <div class="slax-menus" ref="menus" v-if="!needHidden"></div>
  <div class="slax-custom-container" ref="modalContainer"></div>
</template>

<script lang="ts" setup>
import SubscribePlaceholder, { PlaceholderStyle } from './SubscribePlaceholder.vue'
import AIOverview from '@/components/AIOverview.vue'
import AISummaries from '@/components/AISummaries.vue'
import ChatBot from '@/components/Chat/ChatBot.vue'
import PanelOperate from '@/components/PanelOperate.vue'
import PanelView from '@/components/PanelView.vue'
import ArticleCommentsView from '@/components/Selection/ArticleCommentsView.vue'
import SidebarItems from '@/components/SidebarItems.vue'
import SidebarTips from '@/components/Tips/SidebarTips.vue'

import { type BookmarkLookupResult, type BridgeBookmarkPayload, type MessageType, MessageTypeAction } from '@/config/message'
import { Images, type PanelItem, PanelItemType } from '@/config/panel'

import { checkUserSubscribedIsExpired } from '@/utils/examine'
import { RequestError } from '@commons/frontend-utils/request'

import { setBridgeBookmarkUid } from '@/bridge/request'
import { BridgeBookmarkProvider, BridgeHttpClient } from '@/bridge/selectionAdapters'
import { showFeedbackModal, showShareConfigModal } from '@/components/Modal'
import { ExtensionsEnvironmentAdapter, ExtensionsI18nService, ExtensionsToastService, ExtensionsUserProvider } from '@/components/Selection/adapters'
import { ExtensionsArticleSelection } from '@/components/Selection/ExtensionsArticleSelection'
import { MarkModal } from '@/components/Selection/modal'
import Toast from '@/components/Toast'
import { ToastType } from '@/components/Toast/type'
import { RESTMethodPath } from '@commons/types/const'
import { type AddBookmarkReq, type BookmarkBriefDetail, type MarkDetail, type MarkInfo, MarkType as BackendMarkType, type UserInfo } from '@commons/types/interface'
import type { MarkCommentInfo, MarkItemInfo, QuoteData } from '@slax-reader/selection/types'
import { onKeyStroke } from '@vueuse/core'
import type { WxtBrowser } from 'wxt/browser'

const props = defineProps({
  browser: {
    type: Object as PropType<WxtBrowser>,
    required: true
  }
})

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
const isCollected = ref(false)
const subPanelItems = ref<PanelItem[]>([
  {
    type: PanelItemType.Outline,
    icon: Images.outline.sub,
    highlighedIcon: Images.outline.highlighted,
    selectedIcon: Images.outline.selected,
    title: $t('component.sidebar.outline'),
    hovered: false,
    isSelected: () => isSummaryShowing.value
  },
  {
    type: PanelItemType.Chat,
    icon: Images.chatbot.sub,
    highlighedIcon: Images.chatbot.highlighted,
    selectedIcon: Images.chatbot.selected,
    title: $t('component.sidebar.chat'),
    hovered: false,
    isSelected: () => isChatbotShowing.value
  },
  {
    type: PanelItemType.Comments,
    icon: Images.comments.sub,
    highlighedIcon: Images.comments.highlighted,
    selectedIcon: Images.comments.selected,
    title: $t('component.sidebar.comments'),
    hovered: false,
    isSelected: () => isCommentShowing.value
  }
])

const menus = ref<HTMLDivElement>()
const modalContainer = useTemplateRef<HTMLDivElement>('modalContainer')

const summaries = ref<InstanceType<typeof AISummaries>>()
const chatbot = ref<InstanceType<typeof ChatBot>>()
const comments = ref<InstanceType<typeof ArticleCommentsView>>()

const bookmarkUid = ref<string | null>(null)
const bookmarkUrl = ref('')
const currentUrl = ref(window.location.href)
type ExtensionBookmarkBriefInfo = BookmarkBriefDetail
const bookmarkBriefInfo = ref<ExtensionBookmarkBriefInfo | null>(null)
const hasBookmarkReference = computed(() => !!bookmarkUid.value)
const bookmarkReferenceKey = computed(() => bookmarkUid.value ?? '')

const lastOpenItem = ref<PanelItemType>()
const isSummaryShowing = ref(false)
const isChatbotShowing = ref(false)
const isCommentShowing = ref(false)

// 鼠标移出后的收起延时
const COLLAPSE_DELAY = 2000
// 收藏后收起：比收藏卡片晚 2s
const COLLECT_COLLAPSE_DELAY = 4000
const isWebPanelExpanded = ref(false)
const isHandleVisible = ref(true)
const isHandleHinting = ref(false)
const isMorePanelOpen = ref(false)
let collapseTimer: ReturnType<typeof setTimeout> | null = null
let hintResetTimer: ReturnType<typeof setTimeout> | null = null

const expandWebPanel = () => {
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
  isWebPanelExpanded.value = true
  isHandleVisible.value = false
}

const collapseWebPanel = () => {
  isWebPanelExpanded.value = false
  isHandleVisible.value = true
  isHandleHinting.value = false
  if (hintResetTimer) clearTimeout(hintResetTimer)
  requestAnimationFrame(() => {
    isHandleHinting.value = true
    hintResetTimer = setTimeout(() => {
      isHandleHinting.value = false
    }, 2500)
  })
}

const scheduleCollapseIn = (delay: number) => {
  if (showPanel.value || isMorePanelOpen.value) return
  if (collapseTimer) clearTimeout(collapseTimer)
  collapseTimer = setTimeout(collapseWebPanel, delay)
}

// 无参版供模板 @mouseleave
const scheduleCollapse = () => scheduleCollapseIn(COLLAPSE_DELAY)

const onMorePanelOpen = () => {
  isMorePanelOpen.value = true
  cancelCollapse()
}

const onMorePanelClose = () => {
  isMorePanelOpen.value = false

  expandWebPanel()
  scheduleCollapse()
}

const isDismissed = ref(false)

const onSidebarDismiss = () => {
  isDismissed.value = true
  if (collapseTimer) clearTimeout(collapseTimer)
  if (hintResetTimer) clearTimeout(hintResetTimer)
}

const cancelCollapse = () => {
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
}

const isLoading = ref(false)

let articleSelection: ExtensionsArticleSelection | null = null
let selectionUserProvider: ExtensionsUserProvider | null = null

const userInfo = ref<UserInfo | null>(null)
const isSubscribed = computed(() => Boolean(userInfo.value && !checkUserSubscribedIsExpired(userInfo.value)))
const showPanel = computed(() => {
  return isSummaryShowing.value || isChatbotShowing.value || isCommentShowing.value
})

const needHidden = computed(() => {
  return isSlaxWebsite(currentUrl.value) || !hasBookmarkReference.value
})

const addLog = () => {
  // trackEvent({
  //   event: 'bookmark_view',
  //   id: bookmarkUid.value,
  //   mode: 'original'
  // })
}

watch(
  bookmarkUid,
  uid => {
    if (!uid) {
      bookmarkBriefInfo.value = null
      unloadSelection()
      return
    }

    addLog()
  }
)

props.browser.runtime.onMessage.addListener(
  (message: unknown, _sender: Browser.runtime.MessageSender, sendResponse: (response?: 'string' | Record<string, string | number>) => void) => {
    const receiveMessage = message as MessageType
    switch (receiveMessage.action) {
      case MessageTypeAction.PageUrlUpdate: {
        const url = receiveMessage.url
        if (url !== bookmarkUrl.value) {
          currentUrl.value = url
          updateBookmarkStatus(url)
        }

        break
      }
      case MessageTypeAction.BookmarkStatusRefresh: {
        if (!receiveMessage.bookmarkUid || receiveMessage.bookmarkUid === bookmarkUid.value) {
          updateBookmarkStatus(currentUrl.value)
        }

        break
      }
    }

    return false
  }
)

onMounted(() => {
  updateBookmarkStatus()
})

onKeyStroke(['z', 'Z'], e => {
  if (needHidden.value) {
    return
  }

  const ctrlFire = (e.ctrlKey && !isMac) || ((e.ctrlKey || e.metaKey) && isMac)
  if (ctrlFire && e.shiftKey) {
    e.preventDefault()

    if (!showPanel.value) {
      panelClick(subPanelItems.value.find(item => item.type === lastOpenItem.value) ?? subPanelItems.value[0])
    } else {
      closePanel()
    }
  }
})

let bookmarkStatusRequest = 0
const updateBookmarkStatus = async (url = window.location.href) => {
  const requestId = ++bookmarkStatusRequest
  if (url !== bookmarkUrl.value) {
    bookmarkBriefInfo.value = null
    bookmarkUid.value = null
    setBridgeBookmarkUid(null)
    isCollected.value = false
  }

  const bookmarkRecord = await tryGetBookmarkChange(url)
  if (requestId !== bookmarkStatusRequest || url !== currentUrl.value) return

  if (bookmarkRecord) {
    bookmarkUid.value = bookmarkRecord.bookmarkUid
    setBridgeBookmarkUid(bookmarkRecord.bookmarkUid)
    bookmarkUrl.value = url
    isCollected.value = hasBookmarkReference.value
    bookmarkBriefInfo.value = bookmarkRecord.bookmark ? bridgeBookmarkToBrief(bookmarkRecord.bookmark) : null
    if (bookmarkBriefInfo.value) await loadSelection()
    if (isCollected.value) {
      expandWebPanel()
      scheduleCollapseIn(COLLECT_COLLAPSE_DELAY)
    }
  } else {
    bookmarkUrl.value = ''
    bookmarkUid.value = null
    setBridgeBookmarkUid(null)
    bookmarkBriefInfo.value = null
    isCollected.value = false
  }
}

type BookmarkReference = { bookmarkUid: string }

const currentBookmarkReference = (): BookmarkReference | null => {
  if (bookmarkUid.value) return { bookmarkUid: bookmarkUid.value }
  return null
}

const bookmarkRefParam = (ref: BookmarkReference): Record<string, string> => ({ bookmark_uid: ref.bookmarkUid })

const bridgeMarksToDetail = (marks: BridgeBookmarkPayload['marks']): MarkDetail => {
  const convert = (mark: BridgeBookmarkPayload['marks']['mark_list'][number]): MarkInfo => ({
    id: mark.id,
    uuid: mark.uuid,
    user_id: mark.user_id,
    type: mark.type as MarkInfo['type'],
    source: mark.source as MarkInfo['source'],
    approx_source: mark.approx_source as MarkInfo['approx_source'],
    parent_id: mark.parent_id,
    parent_uid: mark.parent_uid,
    root_id: mark.root_id,
    root_uid: mark.root_uid,
    comment: mark.comment,
    created_at: new Date(mark.created_at),
    is_deleted: mark.is_deleted,
    children: mark.children.map(convert)
  })

  return {
    mark_list: marks.mark_list.map(convert),
    user_list: marks.user_list
  }
}

const bridgeBookmarkToBrief = (bookmark: BridgeBookmarkPayload): ExtensionBookmarkBriefInfo => ({
  bookmark_id: 1,
  target_url: bookmark.url,
  created_at: new Date(bookmark.created_at),
  updated_at: new Date(bookmark.updated_at),
  title: bookmark.title,
  host_url: bookmark.host_url,
  site_name: bookmark.site_name,
  content_icon: bookmark.content_icon,
  content_cover: bookmark.content_cover,
  content_word_count: bookmark.content_word_count,
  description: bookmark.description,
  byline: bookmark.byline,
  status: bookmark.status,
  published_at: new Date(bookmark.published_at || bookmark.created_at),
  marks: bridgeMarksToDetail(bookmark.marks),
  bookmark_user_uuid: bookmark.uuid,
  alias_title: bookmark.alias_title,
  archived: bookmark.archived,
  starred: bookmark.starred,
  overview: bookmark.overview,
  key_takeaways: bookmark.key_takeaways,
  tags: bookmark.tags.map(tag => ({ ...tag, id: tag.id as unknown as number }))
})

const ensureLoggedIn = async () => {
  const response = await props.browser.runtime.sendMessage({ action: MessageTypeAction.CheckLogined })
  if (!response?.success) return false
  await tryGetUserInfo()
  return true
}

const loadSelection = async () => {
  unloadSelection()

  if (!needHidden.value && bookmarkBriefInfo.value) {
    const markList = bookmarkBriefInfo.value.marks
    const user = userInfo.value ?? (await tryGetUserInfo())
    await nextTick()
    if (!menus.value) return
    selectionUserProvider = new ExtensionsUserProvider(user)

    const config = {
      allowAction: true,
      containerDom: menus.value,
      monitorDom: document.body as HTMLDivElement,
      postQuoteDataHandler: async (data: QuoteData) => {
        if (!(await ensureLoggedIn())) return
        closePanel()
        isChatbotShowing.value = true
        chatbot.value?.addQuoteData(data)
        chatbot.value?.focusTextarea()
      },
      markCommentSelectHandler: async (comment: MarkCommentInfo) => {
        if (!(await ensureLoggedIn())) return
        closePanel()
        isCommentShowing.value = true
        nextTick(() => {
          comments.value?.navigateToComment(comment)
        })
      },
      menusCommentHandler: async (info: MarkItemInfo, data: QuoteData['data']) => {
        if (!(await ensureLoggedIn())) return
        closePanel()
        isCommentShowing.value = true
        nextTick(() => {
          comments.value?.showPostCommentView(info, data)
        })
      }
    }

    const dependencies = {
      userProvider: selectionUserProvider,
      httpClient: new BridgeHttpClient(() => bookmarkUid.value ?? undefined),
      toastService: new ExtensionsToastService(),
      i18nService: new ExtensionsI18nService(),
      environmentAdapter: new ExtensionsEnvironmentAdapter(),
      bookmarkProvider: new BridgeBookmarkProvider(() => bookmarkUid.value ?? undefined),
      refFactory: ref, // 使用 Vue 的 ref 作为工厂函数
      getMarkType: (type: 'comment' | 'reply' | 'line') => {
        // Extensions 端总是返回 ORIGIN 类型
        if (type === 'comment') {
          return BackendMarkType.ORIGIN_COMMENT
        } else if (type === 'reply') {
          return BackendMarkType.REPLY
        } else {
          return BackendMarkType.ORIGIN_LINE
        }
      }
    }

    const modal = new MarkModal(config, selectionUserProvider)

    articleSelection = new ExtensionsArticleSelection(config, dependencies, modal)

    if (markList) {
      articleSelection.drawMark(markList)
    }

    articleSelection.startMonitor()
  }
}

const unloadSelection = () => {
  if (articleSelection) {
    articleSelection.closeMonitor()
    articleSelection = null
    selectionUserProvider = null
  }
}

const panelClick = async (panel: PanelItem) => {
  const type = panel.type
  if (isLoading.value && type === PanelItemType.Share) {
    return
  }

  if ([PanelItemType.AI, PanelItemType.Outline, PanelItemType.Chat, PanelItemType.Comments].includes(type)) {
    if (!(await ensureLoggedIn())) return
  }

  props.browser.runtime.sendMessage({
    action: MessageTypeAction.TrackDashboardMetric
  })

  if ([PanelItemType.AI, PanelItemType.Outline, PanelItemType.Chat, PanelItemType.Comments].indexOf(type) > -1) {
    if (!hasBookmarkReference.value) await addBookmark()
    if (!hasBookmarkReference.value) return
    closePanel()
    expandWebPanel()
  }

  switch (type) {
    case PanelItemType.Outline:
    case PanelItemType.AI: {
      isSummaryShowing.value = !isSummaryShowing.value
      if (isSummaryShowing.value && isSubscribed.value) {
        props.browser.runtime.sendMessage({
          action: MessageTypeAction.TrackDashboardMetric,
          actionType: 'ai_summary'
        })
        props.browser.runtime.sendMessage({
          action: MessageTypeAction.TrackDashboardMetric,
          actionType: 'ai_overview'
        })
      }
      break
    }
    case PanelItemType.Chat: {
      isChatbotShowing.value = !isChatbotShowing.value
      break
    }
    case PanelItemType.Comments: {
      isCommentShowing.value = !isCommentShowing.value
      break
    }
    case PanelItemType.Share: {
      if (!hasBookmarkReference.value) await addBookmark()

      const resolvedBookmarkUuid = bookmarkUid.value ?? bookmarkBriefInfo.value?.bookmark_user_uuid
      if (!resolvedBookmarkUuid) return

      modalContainer.value &&
        showShareConfigModal({
          bookmarkId: 1,
          bookmarkUuid: resolvedBookmarkUuid,
          title: document.title,
          container: modalContainer.value
        })

      break
    }
    case PanelItemType.Archieve: {
      if (panel.isLoading) {
        panel.finishHandler = undefined
        return
      }

      const archieve = !(bookmarkBriefInfo.value?.archived === 'archive')
      const status = archieve ? 'archive' : 'inbox'
      // panel.isLoading = true

      if (bookmarkBriefInfo.value) {
        bookmarkBriefInfo.value.archived = status
      }

      try {
        const reference = currentBookmarkReference()
        if (!reference) return
        await request.post<{ bookmark_uid: string; status: string }>({
          url: RESTMethodPath.BOOKMARK_ARCHIVE,
          body: {
            ...bookmarkRefParam(reference),
            status
          }
        })
      } catch (err) {
        if (bookmarkBriefInfo.value) {
          bookmarkBriefInfo.value.archived = archieve ? 'inbox' : 'archive'
        }
      }

      trackEvent({
        event: 'bookmark_archive',
        is_archived: archieve,
        source: 'bookmark'
      })

      // panel.isLoading = false

      panel.finishHandler && panel.finishHandler()
      panel.finishHandler = undefined

      break
    }

    case PanelItemType.Star: {
      if (panel.isLoading) {
        panel.finishHandler = undefined
        return
      }

      const starred = !(bookmarkBriefInfo.value?.starred === 'star')
      const status = starred ? 'star' : 'unstar'
      // panel.isLoading = true

      if (bookmarkBriefInfo.value) {
        bookmarkBriefInfo.value.starred = status
      }

      try {
        const reference = currentBookmarkReference()
        if (!reference) return
        await request.post<{ bookmark_uid: string; status: string }>({
          url: RESTMethodPath.BOOKMARK_STAR,
          body: {
            ...bookmarkRefParam(reference),
            status
          }
        })
      } catch (err) {
        if (bookmarkBriefInfo.value) {
          bookmarkBriefInfo.value.starred = starred ? 'unstar' : 'star'
        }
      }

      trackEvent({
        event: 'bookmark_star',
        is_starred: starred,
        source: 'bookmark'
      })

      // panel.isLoading = false

      panel.finishHandler && panel.finishHandler()
      panel.finishHandler = undefined
      break
    }

    case PanelItemType.Feedback: {
      const bookmarkUuid = bookmarkUid.value
      if (!bookmarkUuid) return
      const href = `${window.location.origin}${window.location.pathname}`
      const feedbackParams: Record<string, string> = {
        entry_point: 'original_website',
        target_url: href,
        bookmark_uuid: bookmarkUuid
      }

      modalContainer.value &&
        showFeedbackModal({
          reportType: 'parse_error',
          title: bookmarkBriefInfo.value?.alias_title || bookmarkBriefInfo.value?.title || '',
          params: feedbackParams,
          href,
          email: userInfo.value?.email || '',
          container: modalContainer.value
        })
      break
    }
  }
}

const findQuote = (quote: QuoteData) => {
  articleSelection?.findQuote(quote)
}

const closePanel = () => {
  if (isSummaryShowing.value) {
    lastOpenItem.value = PanelItemType.AI
  } else if (isChatbotShowing.value) {
    lastOpenItem.value = PanelItemType.Chat
  } else if (isCommentShowing.value) {
    lastOpenItem.value = PanelItemType.Comments
  } else {
    lastOpenItem.value = undefined
  }

  isSummaryShowing.value = false
  isChatbotShowing.value = false
  isCommentShowing.value = false
  scheduleCollapse()
}

const getRequestParams = () => {
  const params = getWebSiteInfo()
  return params as AddBookmarkReq
}

const tryGetUserInfo = async () => {
  const res = await queryBackground<UserInfo>({ action: MessageTypeAction.QueryUserInfo })
  if (!res?.success) return null
  userInfo.value = res.data ?? null
  selectionUserProvider?.updateUserInfo(userInfo.value)
  return userInfo.value
}

const tryGetBookmarkChange = async (url: string): Promise<BookmarkLookupResult | null> => {
  const res = await queryBackground<BookmarkLookupResult>({
    action: MessageTypeAction.QueryBookmarkChange,
    url
  })

  if (!res || !res.success) {
    return null
  }

  return res.data
}

const queryBackground = async <R extends object>(params: MessageType) => {
  const res = await props.browser.runtime.sendMessage<MessageType, { success: true; data: R } | { success: false; data?: Error }>(params)
  return res
}

const waitForAddedBookmark = async (url: string): Promise<BookmarkLookupResult | null> => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const lookup = await tryGetBookmarkChange(url)
    if (!lookup?.bridgeReady) return null
    if (lookup.bookmarkUid) return lookup
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  return null
}

let addBookmarkInFlight: Promise<boolean> | null = null
const addBookmark = async (): Promise<boolean> => {
  if (hasBookmarkReference.value) return true
  if (addBookmarkInFlight) return addBookmarkInFlight

  addBookmarkInFlight = (async () => {
    isLoading.value = true
    try {
      const body = getRequestParams()
      const resp = await request.post<unknown>({
        url: RESTMethodPath.ADD_BOOKMARK,
        body
      })

      if (!resp) return false

      const resolved = await waitForAddedBookmark(body.target_url)
      if (!resolved?.bookmarkUid) return false

      bookmarkUid.value = resolved.bookmarkUid
      setBridgeBookmarkUid(resolved.bookmarkUid)
      bookmarkUrl.value = body.target_url
      bookmarkBriefInfo.value = resolved.bookmark ? bridgeBookmarkToBrief(resolved.bookmark) : null
      isCollected.value = true
      if (bookmarkBriefInfo.value) await loadSelection()
      return true
    } catch (error) {
      // Labs gate: the server copy already says to turn it on in Settings
      if (error instanceof RequestError && error.name === 'LAB_FEATURE_DISABLED') {
        Toast.showToast({ text: error.message, type: ToastType.Error })
        return false
      }
      throw error
    } finally {
      isLoading.value = false
    }
  })()

  try {
    return await addBookmarkInFlight
  } finally {
    addBookmarkInFlight = null
  }
}
</script>

<style lang="scss" scoped>
.button-wrapper {
  --style: relative w-full h-56px;

  button {
    --style: absolute top-0 right-0 size-full bg-#1F1F1FCC flex items-center flex-nowrap;

    .selected-bg {
      --style: absolute right-5px top-0 bottom-0 left-0 rounded-r-10px bg-#262626;

      &::before,
      &::after {
        --style: content-empty absolute size-10px z-1 bg-#262626;
      }

      &::before {
        --style: bottom-full left-0;
        clip-path: path('M 0 0 A 10 10 0 0 0 10 10 L 0 10 Z');
      }

      &::after {
        --style: top-full left-0;
        clip-path: path('M 0 0 L 10 0 A 10 10 0 0 0 0 10 L 0 0 Z');
      }
    }

    .icon-wrapper {
      --style: relative z-1 size-full rounded-6px shrink-0 overflow-hidden;

      .icon {
        --style: relative size-full;
        img {
          --style: absolute size-24px left-1/2 top-1/2 -translate-1/2 transition-opacity duration-250 object-contain select-none;
        }

        .normal {
          --style: opacity-100;
        }

        .highlighted {
          --style: opacity-0;
        }
      }
    }

    &:hover {
      .icon {
        .normal {
          --style: opacity-0;
        }

        .highlighted {
          --style: opacity-100;
        }
      }
    }
  }
}

.web-panel {
  --style: z-1 fixed cursor-move left-full top-1/2 translate-x-0 -translate-y-1/2 opacity-0;
  transition:
    transform 0.35s cubic-bezier(0.34, 1.08, 0.64, 1),
    opacity 0.25s ease;

  &.expanded {
    --style: -translate-x-full -translate-y-1/2 opacity-100;
  }
}

.edge-zone {
  --style: fixed z-1 top-0 right-0 h-screen w-30px;
}

.edge-handle {
  --style: fixed z-1 top-1/2 right-0 cursor-pointer flex items-center justify-center w-12px h-96px -translate-y-1/2 rounded-l-6px bg-#50505a80 shadow-[-2px_0_8px_#00000014];
  transition:
    background 0.25s,
    box-shadow 0.25s,
    opacity 0.25s;

  &::after {
    --style: content-empty w-6px h-9px text-white opacity-55 bg-current;
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3'%3E%3Cpath d='M15 18l-6-6 6-6'/%3E%3C/svg%3E");
    mask-size: contain;
    mask-repeat: no-repeat;
    mask-position: center;
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3'%3E%3Cpath d='M15 18l-6-6 6-6'/%3E%3C/svg%3E");
    -webkit-mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    transition: opacity 0.25s;
  }

  &:hover {
    --style: bg-#3c3c46a6 shadow-[-2px_0_14px_#00000026];

    &::after {
      --style: opacity-90;
    }
  }

  &.hint {
    animation: edge-handle-hint 2s ease 0.15s 1;
  }
}

@keyframes edge-handle-hint {
  0%,
  70% {
    background: rgba(80, 80, 90, 0.5);
  }
  35% {
    background: rgba(80, 80, 100, 0.85);
    box-shadow: -2px 0 20px rgba(0, 0, 0, 0.2);
  }
  50% {
    background: rgba(80, 80, 90, 0.5);
  }
}
</style>
