<template>
  <Transition name="popup">
    <div class="slax-popup" :class="{ 'slax-popup-loading': isLoading }" v-show="showPopup" v-on-click-outside="closePopup">
      <div class="header">
        <div class="status">
          <DotLoading v-if="isLoading" />
          <img v-if="!isLoading && tipsDisplay?.kind === 'message' && tipsDisplay.key === 'collection_successful'" class="smile" src="@/assets/smile_face.svg" />
          <span>{{ isLoading ? loadingTitle : statusTitle }}</span>
        </div>
        <button v-if="!isLoading" @click="closePopup">
          <img src="@/assets/close.svg" />
        </button>
      </div>
      <div class="title">
        <span class="">{{ title }}</span>
      </div>
      <a v-if="labBlocked" class="lab-link" :href="labsUrl" target="_blank" rel="noopener">{{ t('open_labs_in_settings') }}</a>
      <div class="content" v-show="!isLoading">
        <div class="slax-buttons collected" v-if="bookmarkId > 0 && false">
          <button class="source" @click="checkSource">{{ t('click_to_view') }}</button>
          <i class="seperator"></i>
          <button class="remove" @click="deleteBookmark">{{ t('removal') }}</button>
        </div>
        <div class="slax-buttons uncollect" v-else-if="bookmarkId === 0">
          <button class="add" @click="addBookmark">{{ t('recollection') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>
<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { onUnmounted } from 'vue'

import DotLoading from './DotLoading.vue'

import { BookmarkActionType, type MessageType, MessageTypeAction } from '@/config/message'

import { type CollectDisplay, formatCollectDisplay } from '@/utils/collectStatus'

import { RequestError } from '@commons/frontend-utils/request'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { AddBookmarkReq, AddBookmarkResp, EmptyBookmarkResp } from '@slax-reader/contracts/interface'
import { vOnClickOutside } from '@vueuse/components'
import type { GeneratedI18nStructure } from '#i18n'
import type { PropType } from 'vue'
import type { WxtBrowser } from 'wxt/browser'

const props = defineProps({
  browser: {
    type: Object as PropType<WxtBrowser>,
    required: true
  }
})

const showPopup = ref(false)
const bookmarkExists = ref(false)
const title = ref('')
const isUrlBlocked = ref(false)
// Labs gate: the server copy goes in the status line, this adds a link to the web settings
const labBlocked = ref(false)
const labsUrl = `${process.env.PUBLIC_BASE_URL}/user#labs`
let keepPopupOpen = false
const bookmarkId = ref(0)
const isLoading = computed(() => {
  return loading.value
})

const loadingKey = ref<keyof GeneratedI18nStructure>('collection_in_progress')
const loadingFrame = ref(0)
const loading = ref(false)
const loadingTitle = computed(() => formatCollectDisplay({ kind: 'message', key: loadingKey.value }, loadingFrame.value))
const loadingInterval = ref<NodeJS.Timeout>()
const tipsDisplay = ref<CollectDisplay>()
const statusTitle = computed(() => {
  if (tipsDisplay.value) {
    return formatCollectDisplay(tipsDisplay.value)
  }

  if (isUrlBlocked.value) {
    return $t('collection_not_supported')
  } else {
    if (bookmarkExists.value) {
      return $t('collected')
    } else {
      return $t('not_collected')
    }
  }
})

const t = (
  name:
    | 'collection_successful'
    | 'collection_in_progress'
    | 'collection_failed'
    | 'collected'
    | 'collection_not_supported'
    | 'recollection'
    | 'not_collected'
    | 'open_labs_in_settings'
    | 'click_to_view'
    | 'removal'
    | 'removal_successful'
    | 'removal_in_progress'
    | 'removal_failed'
) => {
  return $t(name)
}

watch(
  () => loading.value,
  (value, oldValue) => {
    if (value === oldValue) {
      return
    }

    if (value) {
      loadingFrame.value = 0
      loadingInterval.value = setInterval(() => {
        loadingFrame.value = (loadingFrame.value + 1) % 4
      }, 800)
    } else {
      clearInterval(loadingInterval.value)
    }
  }
)

props.browser.runtime.onMessage.addListener(
  (message: unknown, sender: Browser.runtime.MessageSender, sendResponse: (response?: 'string' | Record<string, string | number>) => void) => {
    console.log('receive message', message, sender)

    const action = (message as MessageType).action
    switch (action) {
      case MessageTypeAction.ShowCollectPopup: {
        showPopup.value = true
        break
      }
      case MessageTypeAction.OpenWelcome:
        props.browser.tabs.create({
          url: `${process.env.PUBLIC_BASE_URL}/login?from=extension`
        })
        break

      case MessageTypeAction.QueryHTMLContent:
        sendResponse({
          resp: document.body.innerHTML
        })

        return true
    }

    return false
  }
)

watch(
  () => showPopup.value,
  async (value: boolean) => {
    if (value) {
      void props.browser.runtime.sendMessage({ target: 'slax-background', method: 'collect-screen-viewed' }).catch(() => {})
      updateTitle()
      await addBookmark()
    }
  }
)

onMounted(async () => {
  updateTitle()
})

onUnmounted(() => {
  clearInterval(loadingInterval.value)
})

const updateTitle = () => {
  title.value = document.title || document.querySelector('meta[property="og:title"]')?.getAttribute('content') || `${location.href}${location.pathname}`
}

const addBookmark = async () => {
  labBlocked.value = false
  keepPopupOpen = false
  showLoading('collection_in_progress')
  try {
    const resp = await request.post<AddBookmarkResp>({
      url: RESTMethodPath.ADD_BOOKMARK,
      body: {
        ...getRequestParams()
      }
    })

    if (resp) {
      bookmarkId.value = resp.bmId
      bookmarkExists.value = true
      props.browser.runtime.sendMessage({
        action: MessageTypeAction.RecordBookmark,
        url: window.location.href,
        actionType: BookmarkActionType.ADD,
        bookmarkId: resp.bmId
      })

      showTips({ kind: 'message', key: 'collection_successful' })
    } else {
      showTips({ kind: 'message', key: 'collection_failed' })
    }
  } catch (error) {
    if (error instanceof RequestError) {
      if (error.name === 'BLOCK_TARGET_URL') {
        isUrlBlocked.value = true
        hideLoading()
        return
      }
      if (error.name === 'LAB_FEATURE_DISABLED') {
        labBlocked.value = true
        keepPopupOpen = true
        showTips({ kind: 'raw', text: error.message })
        return
      }
    }

    showTips({ kind: 'message', key: 'collection_failed' })
  } finally {
    // 实验室拦截时留着弹窗，用户要点链接去打开
    if (!keepPopupOpen) {
      setTimeout(() => {
        closePopup()
      }, 2000)
    }
  }
}

const deleteBookmark = async () => {
  if (bookmarkId.value < 1) {
    console.log('bookmarkId is invalid')
    return
  }

  showLoading('removal_in_progress')
  const resp = await request.post<EmptyBookmarkResp>({
    url: RESTMethodPath.DELETE_BOOKMARK,
    body: {
      bookmark_id: bookmarkId.value
    }
  })
  if (resp) {
    bookmarkId.value = 0
    bookmarkExists.value = false
    props.browser.runtime.sendMessage({
      action: MessageTypeAction.RecordBookmark,
      url: window.location.href,
      actionType: BookmarkActionType.DELETE
    })
    showTips({ kind: 'message', key: 'removal_successful' })
  } else {
    showTips({ kind: 'message', key: 'removal_failed' })
  }
}

const getRequestParams = () => {
  const params = getWebSiteInfo()
  return params as AddBookmarkReq
}

const checkSource = () => {
  window.open(`${process.env.PUBLIC_BASE_URL}/bookmarks/${bookmarkId.value}`, '_blank')
}

const showLoading = (key: keyof GeneratedI18nStructure) => {
  tipsDisplay.value = undefined
  loadingKey.value = key
  loading.value = true
}

const hideLoading = () => {
  loading.value = false
}

const showTips = (display: CollectDisplay) => {
  hideLoading()
  tipsDisplay.value = display
}

const closePopup = () => {
  if (loading.value) {
    return
  }

  showPopup.value = false
}
</script>

<style lang="scss" scoped>
.slax-popup {
  --style: fixed top-2 right-2 w-75 z-99999999 bg-white rounded-2xl p-5 pt-6 box-border overflow-hidden shadow shadow-(md gray-400) select-none transition-max-height duration-250
    delay-0 ease-in-out max-h-50 overflow-hidden border-(solid 1px #3333330d) '@dark:(shadow-(md slate-3))';
  box-shadow: 0px 20px 60px 0px #0000001a;

  &.slax-popup-loading {
    --style: max-h-130px;
  }

  .header {
    --style: flex justify-between items-center;

    .status {
      --style: text-#999999 text-13px line-height-18px flex items-center;
      & > * {
        --style: 'not-first:ml-8px';
      }

      .smile {
        --style: animate-tada;
      }
    }

    button {
      --style: 'flex-center w-16px h-16px p-0 hover:(scale-120 opacity-80) active:(scale-130) duration-250 transition-all';
      img {
        --style: w-full h-full;
      }
    }
  }

  .lab-link {
    --style: block mt-2 text-13px underline cursor-pointer text-#16b998;
  }

  .title {
    --style: mt-16px font-bold text-(16px align-left ellipsis #0f1419) line-height-24px overflow-hidden line-clamp-2 break-all;
  }

  .content {
    .slax-buttons {
      --style: flex;

      &.collected {
        --style: mt-16px justify-start items-center;
      }

      &.uncollect {
        --style: mt-16px justify-start items-center;
      }

      .seperator {
        --style: 'mx-8px w-1px h-10px bg-#d6d6d6 flex-shrink-0';
      }

      button {
        --style: 'px-0 h-full rounded-2 text-13px line-height-18px hover:(opacity-80) transition-all duration-250';

        &.add {
          --style: 'text-#5490C2';
        }

        &.source {
          --style: 'text-#5490C2';
        }

        &.remove {
          --style: 'text-#999999 hover:(text-#FF6838)';
        }
      }
    }
  }
}

.popup-leave-to,
.popup-enter-from {
  --style: opacity-0 -translate-y-full;
}

.popup-enter-active,
.popup-leave-active {
  --style: transition-all duration-250 ease-in-out;
}
</style>
