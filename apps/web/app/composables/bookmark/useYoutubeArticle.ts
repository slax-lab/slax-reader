// YouTube AI article: status polling, content loading and the owner's generate / retry actions.
// The backend decides who sees what; this only follows the status it returns.
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { YoutubeArticleContent, YoutubeArticleState, YoutubeArticleStatus } from '@slax-reader/contracts/interface'

// Delay before each poll while the article is being made, then every 15 s, for at most 10 minutes
export const YOUTUBE_ARTICLE_POLL_DELAYS = [2000, 4000, 8000, 15000]
export const YOUTUBE_ARTICLE_POLL_MAX_MS = 10 * 60 * 1000

const WORKING: YoutubeArticleStatus[] = ['pending', 'generating', 'validating']

// Polls must not toast every few seconds when the network hiccups
const silent = () => {}

// Consecutive failed requests before polling gives up for this visit
const MAX_FAILURES = 3

// `loadContent: false` follows the status only: the article arrives in the bookmark body instead
export const useYoutubeArticle = (bookmarkUid: () => string, options: { loadContent?: boolean } = {}) => {
  const withContent = options.loadContent ?? true
  const state = ref<YoutubeArticleState | null>(null)
  const article = ref<YoutubeArticleContent | null>(null)
  const acting = ref(false)
  const timedOut = ref(false)
  // Requests kept failing, so polling stopped for this visit; the reader can try again
  const loadFailed = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let startedAt = 0
  let loadedVersion = ''
  let stopped = false
  // Status and content failures are counted apart: a status that keeps succeeding must not hide
  // content requests that keep failing
  let statusFailures = 0
  let contentFailures = 0

  const isWorking = computed(() => !!state.value && WORKING.includes(state.value.status))
  // Poll while the article is being made, and also to recover from a failed status or content request
  const needsPoll = () => !state.value || isWorking.value || (withContent && state.value.status === 'ready' && !article.value)

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const loadContent = async (version: string) => {
    if (!version || version === loadedVersion) return
    const res = await request()
      .get<YoutubeArticleContent>({ url: RESTMethodPath.YOUTUBE_ARTICLE_CONTENT, query: { bookmark_uid: bookmarkUid(), version }, errorInterceptors: silent })
      .catch(() => null)
    if (stopped) return
    if (!res) {
      contentFailures++
      return
    }
    contentFailures = 0
    article.value = res
    loadedVersion = version
  }

  const schedule = () => {
    clearTimer()
    if (stopped || !needsPoll()) return
    if (statusFailures >= MAX_FAILURES || contentFailures >= MAX_FAILURES) {
      loadFailed.value = true
      return
    }
    if (Date.now() - startedAt >= YOUTUBE_ARTICLE_POLL_MAX_MS) {
      timedOut.value = true
      return
    }
    const delay = YOUTUBE_ARTICLE_POLL_DELAYS[Math.min(attempt, YOUTUBE_ARTICLE_POLL_DELAYS.length - 1)]
    attempt++
    timer = setTimeout(() => void refresh(), delay)
  }

  const apply = async (next: YoutubeArticleState | null | undefined) => {
    if (!next || stopped) return
    if (next.version !== state.value?.version) {
      article.value = null
      loadedVersion = ''
      contentFailures = 0
    }
    state.value = next
    if (withContent && next.status === 'ready' && next.version) await loadContent(next.version)
    schedule()
  }

  const refresh = async () => {
    const uid = bookmarkUid()
    if (!uid) return
    const res = await request()
      .get<YoutubeArticleState>({ url: RESTMethodPath.YOUTUBE_ARTICLE_STATUS, query: { bookmark_uid: uid }, errorInterceptors: silent })
      .catch(() => null)
    if (res) {
      statusFailures = 0
      await apply(res)
    } else {
      statusFailures++
      schedule()
    }
  }

  const restartPolling = () => {
    attempt = 0
    statusFailures = 0
    contentFailures = 0
    startedAt = Date.now()
    timedOut.value = false
    loadFailed.value = false
  }

  const start = async () => {
    stopped = false
    restartPolling()
    await refresh()
  }

  const stop = () => {
    stopped = true
    clearTimer()
  }

  // Owner actions keep the default error toast
  const act = async (mode: 'generate' | 'retry') => {
    if (acting.value) return
    acting.value = true
    try {
      const res = await request()
        .post<YoutubeArticleState>({
          url: mode === 'generate' ? RESTMethodPath.YOUTUBE_ARTICLE_GENERATE : RESTMethodPath.YOUTUBE_ARTICLE_RETRY,
          body: { bookmark_uid: bookmarkUid() }
        })
        .catch(() => null)
      restartPolling()
      await apply(res)
    } finally {
      acting.value = false
    }
  }

  return { state, article, acting, timedOut, loadFailed, isWorking, start, stop, refresh, generate: () => act('generate'), retry: () => act('retry') }
}

export default useYoutubeArticle
