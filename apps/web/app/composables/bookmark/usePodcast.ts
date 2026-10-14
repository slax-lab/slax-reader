// Podcast transcript: status polling, the translation, and the owner's retry. The backend decides
// who sees what; this only follows the status it returns.
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { PodcastState, PodcastTranslation } from '@slax-reader/contracts/interface'

/** Delay before each poll while work is going on, then every 15 s, for at most 3 hours. */
export const PODCAST_POLL_DELAYS = [3000, 8000, 15000]
export const PODCAST_POLL_MAX_MS = 3 * 60 * 60 * 1000

const silent = () => {}
const MAX_FAILURES = 3

export type PodcastPhase = 'queued' | 'transcribing' | 'writing' | 'limit_reached' | 'failed' | 'done' | 'hidden'

/** What the status line says about the original-language transcript. */
export const podcastPhase = (s: PodcastState | null): PodcastPhase => {
  if (!s || s.transcript === 'unavailable') return 'hidden'
  if (s.reason === 'limit_reached') return 'limit_reached'
  if (s.transcript === 'pending') return 'queued'
  if (s.transcript === 'transcribing') return 'transcribing'
  if (s.transcript === 'failed' || s.transcript === 'skipped') return 'failed'
  if (s.article === 'ready') return 'done'
  if (s.article === 'failed' || s.article === 'skipped') return 'failed'
  return 'writing'
}

const translationWorking = (s: PodcastState | null) => !!s?.translation && ['pending', 'generating', 'validating'].includes(s.translation.status)

export const usePodcast = (bookmarkUid: () => string) => {
  const state = ref<PodcastState | null>(null)
  const translation = ref<PodcastTranslation | null>(null)
  const acting = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let startedAt = 0
  let loadedVersion = ''
  let stopped = false
  let failures = 0
  let translationFailures = 0

  // Polling gave up (failed requests, or the time cap) while work was still running; the reader can check again
  const stalled = ref(false)

  const phase = computed(() => podcastPhase(state.value))
  const needsPoll = () => {
    const s = state.value
    if (!s) return true
    // Not started (daily limit, or never requested): it waits for the owner's retry, not for a poll
    if (s.transcript === 'pending' && s.can_retry) return false
    if (phase.value === 'queued' || phase.value === 'transcribing' || phase.value === 'writing') return true
    return translationWorking(s) || (s.translation?.status === 'ready' && !translation.value && translationFailures < MAX_FAILURES)
  }

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const loadTranslation = async (version: string) => {
    if (!version || version === loadedVersion) return
    const res = await request()
      .get<PodcastTranslation>({ url: RESTMethodPath.PODCAST_TRANSLATION, query: { bookmark_uid: bookmarkUid(), version }, errorInterceptors: silent })
      .catch(() => null)
    if (stopped) return
    if (!res) {
      translationFailures++
      return
    }
    translationFailures = 0
    translation.value = res
    loadedVersion = version
  }

  const schedule = () => {
    clearTimer()
    if (stopped || !needsPoll()) return
    if (failures >= MAX_FAILURES || Date.now() - startedAt >= PODCAST_POLL_MAX_MS) {
      stalled.value = true
      return
    }
    stalled.value = false
    const delay = PODCAST_POLL_DELAYS[Math.min(attempt, PODCAST_POLL_DELAYS.length - 1)]
    attempt++
    timer = setTimeout(() => void refresh(), delay)
  }

  const apply = async (next: PodcastState | null | undefined) => {
    if (!next || stopped) return
    state.value = next
    if (next.translation?.status === 'ready' && next.translation.version) await loadTranslation(next.translation.version)
    schedule()
  }

  const refresh = async () => {
    const uid = bookmarkUid()
    if (!uid) return
    const res = await request()
      .get<PodcastState>({ url: RESTMethodPath.PODCAST_STATUS, query: { bookmark_uid: uid }, errorInterceptors: silent })
      .catch(() => null)
    if (res) {
      failures = 0
      await apply(res)
    } else {
      failures++
      schedule()
    }
  }

  const start = async () => {
    stopped = false
    attempt = 0
    failures = 0
    startedAt = Date.now()
    stalled.value = false
    await refresh()
  }

  const stop = () => {
    stopped = true
    clearTimer()
  }

  // Owner action keeps the default error toast
  const retry = async () => {
    if (acting.value) return
    acting.value = true
    try {
      const res = await request()
        .post<PodcastState>({ url: RESTMethodPath.PODCAST_RETRY, body: { bookmark_uid: bookmarkUid() } })
        .catch(() => null)
      attempt = 0
      failures = 0
      startedAt = Date.now()
      await apply(res)
    } finally {
      acting.value = false
    }
  }

  return { state, translation, phase, acting, stalled, start, stop, refresh, retry }
}

export default usePodcast
