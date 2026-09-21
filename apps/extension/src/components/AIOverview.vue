<template>
  <div class="ai-overview">
    <div class="header">
      <div class="title">{{ bookmarkBriefInfo.title }}</div>
    </div>
    <div class="tags">
      <div class="i-svg-spinners:90-ring w-24px color-#f4c982" v-if="isLoading && tags.length === 0"></div>
      <BookmarkTags v-else :bookmark-id="bookmarkId" :tags="tags" />
    </div>
    <div class="loading" v-if="isLoading">
      <div class="placeholder">
        <div class="row" v-for="(_, index) in Array.from({ length: 3 })" :key="index"></div>
      </div>
    </div>
    <div class="overview-content" v-if="!isLoading">
      <div class="text-content" ref="textContainer" v-if="overviewContent">
        <MarkdownText :text="markdownedOverview" v-resize="resizeHandler" />
      </div>
      <div class="retry" v-else>
        <span>{{ $t('component.overview.text_content_title') }}</span>
        <button @click="loadOverview()">{{ $t('component.overview.retry') }}</button>
      </div>
      <div class="loading-bottom" ref="loadingBottom" v-if="!isDone && isLoading">
        <DotLoading />
      </div>
      <div class="graph-content" v-if="overviewContent">
        <div class="content-rows" v-for="(item, index) in keyTakaways" :key="index">
          <div class="graph-prefix"></div>
          <span> {{ item }} </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import BookmarkTags from './BookmarkTags.vue'
import DotLoading from './DotLoading.vue'
import MarkdownText from './Markdown/MarkdownText.vue'

import { Resize } from '@commons/utils/directive'
import { RequestMethodType } from '@commons/utils/request'

import Toast, { ToastType } from './Toast'
import { RESTMethodPath } from '@commons/types/const'
import type { BookmarkBriefDetail, BookmarkTag } from '@commons/types/interface'

type OverviewSocketData =
  | {
      type: 'progress' | 'done'
      data: {
        overview?: string
        tags?: { id: number; name: string }[]
        tag?: { id: number; name: string }
        key_takeaways?: string[]
        id?: number
      }
    }
  | {
      type: 'error'
      message: string
    }

const props = defineProps({
  isAppeared: {
    required: false,
    type: Boolean
  },
  bookmarkBriefInfo: {
    type: Object as PropType<BookmarkBriefDetail>,
    required: true
  }
})

const isLoading = ref(false)
const isTagLoading = ref(false)
const isDone = ref(false)
const textContainer = ref<HTMLDivElement>()
const loadingBottom = ref<HTMLDivElement>()
const vResize = Resize
const tags = ref<BookmarkTag[]>(props.bookmarkBriefInfo.tags)
const bookmarkId = computed(() => props.bookmarkBriefInfo.bookmark_id)
const overviewContent = ref(props.bookmarkBriefInfo.overview)
const keyTakaways = ref<string[]>(props.bookmarkBriefInfo.key_takeaways)

const MAX_RETRY_COUNT = 3
const RETRY_DELAY_MS = 1500
const retryCount = ref(0)
let lastError: Error | null = null

const markdownedOverview = computed(() => {
  if (overviewContent.value.length > 0) {
    return `<span style="color: #999999;">${$t('component.overview.text_content_title')}</span>` + overviewContent.value
  }

  return ''
})

const addLog = (subAction: 'open' | 'expand' | 'close' | 'collapse') => {
  if (bookmarkId.value) {
    trackEvent({
      event: 'bookmark_overview_interact',
      sub_action: subAction
    })
  }
}

watch(
  () => props.isAppeared,
  (value, oldValue) => {
    if (value && overviewContent.value.length === 0 && !isDone.value && !isLoading.value) {
      loadOverview()

      addLog('open')
    } else if (value) {
      addLog('expand')
    } else if (value !== !!oldValue) {
      addLog('collapse')
    }
  }
)

const queryOverview = async (
  refresh: boolean,
  callback: (
    responseData:
      | { type: 'overview'; content: string }
      | { type: 'tags'; content: { id: number; name: string }[] }
      | { type: 'tag'; content: { id: number; name: string } | null }
      | { type: 'key_takeaways'; content: string[] }
      | null,
    done: boolean,
    error?: Error
  ) => void
) => {
  const requestCallback = await request.stream({
    url: RESTMethodPath.BOOKMARK_OVERVIEW,
    method: RequestMethodType.post,
    body: {
      bookmark_id: bookmarkId.value,
      force: refresh
    }
  })

  let errorCacheText = ''

  requestCallback &&
    requestCallback((text: string, done: boolean) => {
      if (text.length === 0 && done && !isDone.value) {
        callback(null, true)
        return
      }

      try {
        let parsedJsons = []
        try {
          parsedJsons = parseConcatenatedJson(errorCacheText + text)
          errorCacheText = ''
        } catch (e) {
          console.log('need concat', text)
          errorCacheText = text

          if (done) {
            callback(null, true)
          }

          return
        }

        if (parsedJsons.length === 0) {
          callback(null, true)
        } else {
          for (let i = 0; i < parsedJsons.length; i++) {
            const res = parsedJsons[i]
            if (res.type === 'error') {
              throw new Error(res.message)
            } else if (res.type === 'done' || 'done' in res.data) {
              callback(null, true)
              if (done) {
                isLoading.value = false
                isDone.value = true
              }

              return
            } else {
              const isDone = i === parsedJsons.length - 1 ? done : false
              const type = 'overview' in res.data ? 'overview' : 'tags' in res.data ? 'tags' : 'tag' in res.data ? 'tag' : 'key_takeaways' in res.data ? 'key_takeaways' : ''

              switch (type) {
                case 'overview': {
                  callback(
                    {
                      type,
                      content: res.data.overview || ''
                    },
                    isDone
                  )
                  break
                }
                case 'tags': {
                  callback(
                    {
                      type,
                      content: res.data.tags || []
                    },
                    isDone
                  )
                  break
                }
                case 'tag': {
                  callback(
                    {
                      type,
                      content: res.data.tag || null
                    },
                    isDone
                  )
                  break
                }
                case 'key_takeaways': {
                  callback(
                    {
                      type,
                      content: res.data.key_takeaways || []
                    },
                    isDone
                  )
                  break
                }

                default: {
                  callback(null, isDone)
                  break
                }
              }
            }
          }
        }
      } catch (error) {
        console.log(error, text)

        lastError = error instanceof Error ? error : new Error(String(error))
        callback(null, true)
      }
    })
}

const loadOverview = (options?: { refresh?: boolean }) => {
  if (isLoading.value) {
    return
  }
  runOverviewQuery(options)
}

// 重试要跳过重入保护
// 否则定时器永远进不来
let retryTimer: ReturnType<typeof setTimeout> | null = null
let isDisposed = false

const runOverviewQuery = (options?: { refresh?: boolean; isRetry?: boolean }) => {
  if (!options?.isRetry) {
    retryCount.value = 0
  }

  let step = 0
  const timeInterval = setInterval(() => {
    step += 1
  }, 2000)
  let executeStep = 0

  isLoading.value = true

  let isQueryDone = false
  queryOverview(options?.refresh || false, (responseData, done) => {
    if (isQueryDone) {
      return
    }

    if (!responseData) {
    } else {
      if (responseData.type === 'tags') {
        tags.value = responseData.content.map(item => ({
          id: item.id,
          name: item.name,
          show_name: item.name,
          system: true
        }))
      } else if (responseData.type === 'tag') {
        responseData.content?.id &&
          tags.value.push({
            id: responseData.content?.id,
            name: responseData.content?.name || '',
            show_name: responseData.content?.name || '',
            system: true
          })
      } else if (responseData.type === 'overview') {
        overviewContent.value = responseData.content
      } else if (responseData.type === 'key_takeaways') {
        keyTakaways.value = responseData.content
      }
    }

    isLoading.value = overviewContent.value.length === 0
    isQueryDone = done

    if (isQueryDone) {
      isDone.value = true
      clearInterval(timeInterval)
      if (isDisposed) return

      if (overviewContent.value.length === 0 && retryCount.value < MAX_RETRY_COUNT) {
        // 避免闪一下重试按钮
        // 等退避完再真正重试
        retryCount.value += 1
        isDone.value = false
        retryTimer = setTimeout(() => runOverviewQuery({ ...options, isRetry: true }), RETRY_DELAY_MS)
      } else {
        isLoading.value = false
        if (overviewContent.value.length === 0 && lastError) {
          Toast.showToast({ text: `${lastError}`, type: ToastType.Error })
        }
      }
    } else if (executeStep < step) {
      executeStep = step
    }
  })
}

onUnmounted(() => {
  isDisposed = true
  if (retryTimer) clearTimeout(retryTimer)
})

const parseConcatenatedJson = (inputString: string) => {
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

  const arrayOfObjects = fixedParts.map(str => JSON.parse(str)) as OverviewSocketData[]
  return arrayOfObjects
}

const resizeHandler = (_: HTMLDivElement, size: DOMRectReadOnly) => {
  const view = textContainer.value
  if (!view || !(view instanceof HTMLElement)) {
    return
  }

  view.style.height = `${size.height /* + 24 + 22.5 */}px`
  view.style.transition = `height ${isDone.value ? 0 : 0.25}s ease-in-out`

  const loadingEle = loadingBottom.value
  if (!loadingEle || !size || !(loadingEle instanceof HTMLElement)) {
    return
  }

  loadingEle.style.top = `${size.height}px`
}
</script>

<style scoped lang="scss">
.ai-overview {
  --style: px-20px py-30px;

  .header {
    .title {
      --style: text-(20px #ffffffe6) font-semibold line-height-28px;
    }
  }

  .loading {
    --style: select-none;

    .placeholder {
      --style: mt-24px w-full flex flex-col;

      .row {
        --style: w-full h-16px rounded-1 animate-pulse;
        --style: 'not-first:mt-10px bg-gradient-to-r from-#f5f5f3 to-#f5f5f399 dark:(from-#ffffff33 to-#ffffff11)';
      }
    }
  }

  .tags {
    --style: mt-24px;
  }

  .overview-content {
    --style: relative;

    .text-content {
      --style: mt-24px h-0 whitespace-pre-line overflow-hidden;

      span {
        --style: text-16px line-height-24px;
      }

      .markdown-text {
        &:deep(*) {
          --style: text-#ffffffe6 text-16px line-height-24px;
        }

        &:deep(ol) {
          --style: mt-0;
        }

        &:deep(p + p) {
          --style: mt-24px;
        }
      }
    }

    .retry {
      --style: mt-24px whitespace-pre overflow-hidden flex items-center;

      span {
        --style: text-#999999ff;
      }

      button {
        --style: text-16px line-height-24px text-#16B998FF;
      }
    }

    .loading-bottom {
      --style: 'absolute left-0 top-full left-0 transition-top duration-250';
    }

    .graph-content {
      --style: mt-24px w-full flex flex-col;
      .content-rows {
        --style: relative flex items-center w-full py-7px;

        .graph-prefix {
          --style: w-6px h-full absolute top-0 left-0;

          &::before {
            --style: content-empty absolute top-1/2 left-1/2 -translate-1/2 w-6px h-6px rounded-full bg-#262626FF border-(1.5px solid #ffffff3d) z-2;
          }

          &::after {
            --style: content-empty absolute top-0 left-1/2 -translate-x-1/2 w-1px h-full bg-#5A5A5A4D;
          }
        }

        &:first-child {
          .graph-prefix::after {
            --style: top-1/2 h-1/2;
          }
        }

        &:last-child {
          .graph-prefix::after {
            --style: h-1/2;
          }
        }

        span {
          --style: ml-18px text-(15px #ffffff99);
        }
      }
    }
  }
}
</style>
