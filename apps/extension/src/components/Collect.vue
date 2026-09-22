<template>
  <Transition name="popup">
    <div class="slax-popup" :class="{ 'slax-popup-loading': isLoading }" v-show="showPopup" v-on-click-outside="closePopup">
      <div class="header">
        <div class="status">
          <DotLoading v-if="isLoading" />
          <img v-if="!isLoading && statusTitle === successText" class="smile" src="@/assets/smile_face.svg" />
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

import { RequestError } from '@commons/frontend-utils/request'

import { RESTMethodPath } from '@commons/types/const'
import type { AddBookmarkReq, AddBookmarkResp, EmptyBookmarkResp } from '@commons/types/interface'
import { vOnClickOutside } from '@vueuse/components'
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

const successText = i18n.t('collection_successful')
const loadingText = ref(i18n.t('collection_in_progress'))
const loading = ref(false)
const loadingTitle = ref(i18n.t('collection_in_progress'))
const loadingInterval = ref<NodeJS.Timeout>()
const tipsText = ref('')
const statusTitle = computed(() => {
  if (tipsText.value) {
    return tipsText.value
  }

  if (isUrlBlocked.value) {
    return i18n.t('collection_not_supported')
  } else {
    if (bookmarkExists.value) {
      return i18n.t('collected')
    } else {
      return i18n.t('not_collected')
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
  return i18n.t(name)
}

watch(
  () => loading.value,
  (value, oldValue) => {
    if (value === oldValue) {
      return
    }

    if (value) {
      loadingTitle.value = loadingText.value
      loadingInterval.value = setInterval(() => {
        const ellipses = loadingTitle.value.replace(loadingText.value, '')
        loadingTitle.value = `${loadingText.value}${Array.from({ length: (ellipses.length + 1) % 4 })
          .map(() => '.')
          .join('')}`
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

onUnmounted(() => {})

const updateTitle = () => {
  title.value = document.title || document.querySelector('meta[property="og:title"]')?.getAttribute('content') || `${location.href}${location.pathname}`
}

const addBookmark = async () => {
  labBlocked.value = false
  keepPopupOpen = false
  showLoading(i18n.t('collection_in_progress'))
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

      showTips(i18n.t('collection_successful'))
    } else {
      showTips(i18n.t('collection_failed'))
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
        showTips(error.message)
        return
      }
    }

    showTips(i18n.t('collection_failed'))
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

  showLoading(i18n.t('removal_in_progress'))
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
    showTips(i18n.t('removal_successful'))
  } else {
    showTips(i18n.t('removal_failed'))
  }
}

const getRequestParams = () => {
  const params = getWebSiteInfo()
  return params as AddBookmarkReq
}

const checkSource = () => {
  window.open(`${process.env.PUBLIC_BASE_URL}/bookmarks/${bookmarkId.value}`, '_blank')
}

const showLoading = (text: string) => {
  loadingText.value = text
  loading.value = true
}

const hideLoading = () => {
  loadingText.value = ''
  loading.value = false
}

const showTips = (text: string) => {
  hideLoading()
  tipsText.value = text
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
