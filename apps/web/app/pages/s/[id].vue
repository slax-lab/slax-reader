<template>
  <div>
    <SnapshotDetailLayout class="bookmark-detail" @close-panel="activePanel = null">
      <template #topbar>
        <SnapshotTopBar>
          <template #left>
            <button class="app-name" @click="navigateToBookmarks">
              <img src="@images/icon-logo-bookmark.png" width="22" height="22" alt="" />
              {{ $t('common.app.name') }}
            </button>
          </template>
          <template #theme-switcher>
            <ClientOnly><ThemeSwitcher /></ClientOnly>
          </template>
          <template #right>
            <SnapshotSharePopover />
            <SnapshotMoreMenu :actions="moreMenuActions" @action="moreMenuClick" />
          </template>
        </SnapshotTopBar>
      </template>

      <template #tips>
        <ClientOnly>
          <TopTips
            v-show="detail"
            :is-show="true"
            :button-enabled="isShowTransferButton"
            :tipsText="shareText"
            :buttonText="isShowTransferButton === undefined ? '' : isShowTransferButton ? $t('page.share_detail.transfer_save') : $t('page.share_detail.transfered_save')"
            :buttonTextColor="isShowTransferButton ? '#5490C2' : 'txt-light'"
            :background-color="'#EDF8F2'"
            @clickButton="transferSaveClick"
          >
            <template #left>
              <img class="user-icon" v-if="!detail?.user_info?.avatar" src="@images/user-default-avatar.png" alt="" />
              <img class="user-icon" v-else :src="detail.user_info.avatar" alt="" />
            </template>
          </TopTips>
        </ClientOnly>
      </template>

      <BookmarkArticle
        v-if="detail"
        ref="bookmarkArticle"
        :detail="detail"
        :marks="marks"
        @screen-lock-update="screenLockUpdate"
        @bookmark-update="bookmarkUpdate"
        @chat-bot-quote="onChatBotQuote"
      />
      <ClientOnly>
        <div class="login">
          <GoogleLoginButton ref="googleLoginBtn" v-if="!user" :redirect="redirectHref" />
        </div>
      </ClientOnly>

      <template #right-edge-toolbar>
        <SnapshotRightEdgeToolbar v-if="detail" v-model="activePanel" :panel-open="activePanel !== null" />
      </template>

      <template #bottom-toolbar>
        <SnapshotBottomToolbar
          v-if="detail"
          v-show="!(isH5 && activePanel)"
          :actions="bottomToolbarActions"
          :active-panel="activePanel"
          @action="bottomToolbarAction"
          @panel="onBottomPanel"
        />
      </template>

      <template #side-panel>
        <SnapshotSidePanel v-if="detail" :active-tab="activePanel" @update:active-tab="activePanel = $event">
          <template #ai>
            <ClientOnly>
              <SnapshotAIPanel :share-code="shareCode" :is-appeared="activePanel === 'ai'" @dismiss="activePanel = null" />
            </ClientOnly>
          </template>
          <template #chat>
            <SnapshotChatPanel
              v-if="!isSubscriptionExpired"
              ref="chatbot"
              :share-code="shareCode"
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
                  :allow-action="!!detail?.share_info?.allow_action"
                  :user-list="marks?.user_list"
                  @card-click="onCommentCardClick"
                  @reply="onCommentReply"
                  @reply-stroke="onReplyStroke"
                />
                <SnapshotCommentComposer
                  :allow-action="!!detail?.share_info?.allow_action"
                  :article-selection="bookmarkArticleSelection"
                  :pending-selection="pendingSelection"
                  :pending-quote="pendingQuote"
                  :active-info-id="activeInfoId"
                  :infos="commentInfos"
                  :reply-to-uid="replyToUid"
                  :compose-stroke="composeStroke"
                  @sent="onCommentSent"
                  @cancel-reply="onCancelReply"
                />
              </div>
            </ClientOnly>
          </template>
        </SnapshotSidePanel>
      </template>
    </SnapshotDetailLayout>

    <ClientOnly>
      <div class="status" v-if="loading">
        <div class="loading" v-if="loading">
          <div class="i-svg-spinners:90-ring w-1em"></div>
          <span class="ml-5">{{ $t('page.bookmarks_detail.loading') }}</span>
        </div>
      </div>
    </ClientOnly>
  </div>
</template>

<script lang="ts" setup>
import BookmarkArticle from '~/components/Article/BookmarkArticle.vue'
import ThemeSwitcher from '~/components/global/ThemeSwitcher.vue'
import GoogleLoginButton from '~/components/GoogleLoginButton.vue'
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
import TopTips from '~/components/Tips/TopTips.vue'

import { formatDate } from '@commons/frontend-utils/date'
import { isClient, isServer } from '@commons/frontend-utils/is'
import { extractHTMLTextContent } from '@commons/frontend-utils/parse'

import { RESTMethodPath } from '@commons/contracts/const'
import type { BookmarkExistsResp, MarkDetail, ShareBookmarkDetail } from '@commons/contracts/interface'
import type { QuoteData } from '~/components/Chat/type'
import type { SnapshotPanelId } from '~/components/Snapshot/panels'
import Toast, { ToastType } from '~/components/Toast'
import { useBookmark } from '~/composables/bookmark/useBookmark'
import { useCommentPanel } from '~/composables/useCommentPanel'
import { useSnapshotLayout } from '~/composables/useSnapshotLayout'

const { t } = useI18n()
const router = useRoute()
const loading = ref(false)

const config = useRuntimeConfig().public

const googleLoginBtn = ref<InstanceType<typeof GoogleLoginButton>>()
const shareCode = String(router.params.id)
const detail = ref<ShareBookmarkDetail>()
const marks = ref<MarkDetail>()

const bookmarkArticle = ref<InstanceType<typeof BookmarkArticle>>()
const chatbot = ref<InstanceType<typeof SnapshotChatPanel>>()

// 从 BookmarkArticle 暴露的 articleSelection 实例（Phase 5 评论面板）
const bookmarkArticleSelection = computed(() => bookmarkArticle.value?.articleSelection ?? null)

const commentInfos = computed(() => bookmarkArticleSelection.value?.markItemInfos?.value ?? [])

const isShowTransferButton = ref<boolean>()

const shareText = computed(() => {
  return t('page.share_detail.share_text', {
    user: detail.value?.user_info?.nick_name,
    date: formatDate(new Date(detail.value?.share_info?.created_at || ''), 'YYYY-MM-DD')
  })
})

const moreMenuActions = computed<MoreMenuAction[]>(() => [{ id: 'feedback', label: t('common.operate.feedback') }])

// Phase 3：activePanel + BottomToolbar（s 页仅 top 按钮）
const activePanel = ref<SnapshotPanelId | null>(null)

// 同步 panelOpen 到 useSnapshotLayout，驱动三档布局挤压
const { panelOpen, isH5 } = useSnapshotLayout()

// 小屏底部栏点击面板：切换 activePanel（经下面的 watch 走登录/订阅校验）
const onBottomPanel = (id: SnapshotPanelId) => {
  activePanel.value = activePanel.value === id ? null : id
}

watch(activePanel, (val, oldVal) => {
  if (val === 'ai' && !showAnalyzed()) {
    activePanel.value = oldVal ?? null
    return
  }
  if (val === 'chat' && !showChatbot()) {
    activePanel.value = oldVal ?? null
    return
  }
  panelOpen.value = val !== null
})

// Phase 5：评论面板联动（必须在 activePanel 声明之后）
const { activeInfoId, pendingSelection, pendingQuote, composeStroke, focusByInfoId, flashMarkByInfoId } = useCommentPanel({
  activePanel,
  articleSelection: bookmarkArticleSelection
})

const replyToUid = ref<string | null>(null)

const onCommentCardClick = (infoId: string) => {
  flashMarkByInfoId(infoId)
}

const onCommentReply = (comment: { markUid: string }) => {
  const infos = bookmarkArticleSelection.value?.markItemInfos?.value ?? []
  for (const info of infos) {
    const found = info.comments.some(c => c.markUid === comment.markUid || c.children?.some(ch => ch.markUid === comment.markUid))
    if (found) {
      activeInfoId.value = info.id
      replyToUid.value = comment.markUid
      break
    }
  }
}

const onReplyStroke = (infoId: string) => {
  activeInfoId.value = infoId
  replyToUid.value = null
  // 显式补评论意图，才弹输入框
  composeStroke.value = true
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

const topIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`

const bottomToolbarActions = computed<BottomToolbarAction[]>(() => [{ id: 'top', icon: topIcon, label: t('common.operate.top') }])

const bottomToolbarAction = (action: BottomToolbarAction) => {
  if (action.id === 'top') backToTop()
}

const defineSeo = () => {
  if (!detail.value) {
    return
  }

  const wordText = extractHTMLTextContent(detail.value?.content || '')
  const title = `${detail.value?.title} - ${t('common.app.name')}`
  const description = wordText.length < 60 ? wordText : wordText.slice(0, 60)
  const sourceUrl = detail.value?.target_url ?? `${config.SHARE_BASE_URL}/s/${shareCode}`

  useHead({
    titleTemplate: `${detail.value?.title} - ${t('common.app.name')}`,
    link: [
      {
        rel: 'canonical',
        href: sourceUrl
      }
    ]
  })

  useSeoMeta({
    title,
    description,
    ogType: 'article',
    ogDescription: description,
    applicationName: t('common.app.name'),
    author: detail.value?.user_info.nick_name,
    twitterTitle: title,
    twitterDescription: description
  })

  useSchemaOrg([
    defineWebPage({
      name: title,
      description: description,
      datePublished: detail.value?.share_info.created_at
    }),

    defineArticle({
      '@id': '#article',
      headline: title,
      description: description,
      image: detail.value?.user_info.avatar,
      datePublished: detail.value?.share_info.created_at,
      isBasedOn: sourceUrl
    })
  ])
}

const loadMarks = async () => {
  try {
    const res = await request().get<MarkDetail>({
      url: RESTMethodPath.SHARE_BOOKMARK_MARK_LIST,
      query: {
        share_code: shareCode
      }
    })

    marks.value = res
  } catch (error) {
    marks.value = {
      mark_list: [],
      user_list: {}
    }
  }
}

const loadBookmarkDetail = async () => {
  if (!detail.value) {
    const data = await request().get<ShareBookmarkDetail>({
      url: RESTMethodPath.SHARE_BOOKMARK_DETAIL,
      query: {
        share_code: shareCode
      }
    })

    data && (detail.value = data)
  }

  await loadMarks()
}

const fetchServerData = async () => {
  const { data } = await useAsyncData('detail', () =>
    request().get<ShareBookmarkDetail>({
      url: RESTMethodPath.SHARE_BOOKMARK_DETAIL,
      query: {
        share_code: shareCode
      }
    })
  )

  data.value && (detail.value = data.value)
}

const renderServerData = async () => {
  try {
    isServer &&
      defineOgImage('Share', {
        title: `${detail.value?.title || ''}`
      })

    defineSeo()
  } catch (error) {
    console.error(error)
  }
}

await fetchServerData()
await renderServerData()

const {
  user,
  isSubscriptionExpired,
  redirectHref,
  showAnalyzed,
  showChatbot,
  chatBotQuote,
  showFeedback,
  backToTop,
  loginVerify,
  screenLockUpdate,
  navigateToNotification,
  navigateToBookmarks
} = useBookmark({
  chatbot,
  typeOptions: () => {
    return {
      type: BookmarkType.Share,
      title: detail.value?.title || '',
      shareCode
    }
  },
  initialRequestTask: async () => {
    if (!isClient) {
      return
    }

    await loadBookmarkDetail()
  },
  initialTasksCompleted: () => {
    if (!isClient) {
      return
    }

    nextTick(() => {
      // 桌面态默认打开 comment tab（snapshot.md §4.3）
      const isMobile = window.innerWidth <= 768
      if (!isMobile) {
        activePanel.value = 'comment'
      }
    })
  }
})

const checkShowTransferButton = () => {
  request()
    .post<BookmarkExistsResp>({
      url: RESTMethodPath.BOOKMARK_EXISTS,
      body: {
        target_url: location.href
      }
    })
    .then(res => {
      isShowTransferButton.value = !res?.exists
    })
}

if (isClient) {
  watch(
    () => user.value,
    (value, oldValue) => {
      if (value && value.userId !== oldValue?.userId) {
        checkShowTransferButton()
      }
    },
    { immediate: true }
  )
}

const bookmarkUpdate = (updateDetail: ShareBookmarkDetail) => {
  detail.value = updateDetail
}

const findQuote = (quote: QuoteData) => {
  bookmarkArticle.value?.findQuote(quote)
}

// 划词点 Chat：先切侧栏再塞引用
const onChatBotQuote = (quote: QuoteData) => {
  if (activePanel.value !== 'chat') {
    activePanel.value = 'chat'
  }
  chatBotQuote(quote)
}

const transferSaveClick = () => {
  if (!loginVerify()) {
    return
  }

  request()
    .post<{ bmId: number }>({
      url: RESTMethodPath.ADD_URL_BOOKMARK,
      body: {
        target_url: location.href
      }
    })
    .then(res => {
      isShowTransferButton.value = false
      Toast.showToast({
        text: t('common.tips.transfer_save_success'),
        type: ToastType.Success
      })
    })
}

const moreMenuClick = (action: MoreMenuAction) => {
  if (action.id === 'feedback') {
    showFeedback()
  }
}
</script>

<style lang="scss" scoped>
.bookmark-detail {
  // 公开快照页归在 snapshot 档（design-system §5.1：52px），
  // 通过 override --slax-header-height 让本页的 DetailLayout .header-container（h-header）拿到 52
  --slax-header-height: var(--slax-header-h-snapshot);

  --style: w-full min-h-screen relative flex justify-center items-start;

  .user-icon {
    --style: 'rounded-full border-(1px txt-btn solid) w-24px h-24px relative overflow-hidden cursor-pointer transition-transform duration-normal hover:scale-102 active:scale-105';
    img {
      --style: absolute w-full h-full top-0 left-0 object-contain;
    }
  }

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

  .login {
    --style: flex-center mt-0 pb-170px;
  }
}

.comment-panel-wrap {
  --style: h-full flex flex-col overflow-hidden;
}

.status {
  --style: fixed inset-0 flex-center;

  .loading {
    --style: relative p-10 flex-1 flex-center max-w-3xl min-h-screen text-(slate lg) z-100;
  }
}
</style>

<!-- eslint-disable-next-line vue-scoped-css/enforce-style-type -->
<style lang="scss">
html {
  --style: bg-surface-solid;
}
/* 渐变走全局 token，同列表页 */
</style>
