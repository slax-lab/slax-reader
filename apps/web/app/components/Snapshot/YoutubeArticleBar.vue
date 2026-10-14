<template>
  <section v-if="visible" class="youtube-article-bar">
    <!-- One live region that stays in the DOM, so every status change is announced -->
    <div class="yt-bar-status-region" role="status" aria-live="polite">
      <YoutubeArticleStatus :state="state" :is-working="isWorking" :timed-out="timedOut" :acting="acting" :last="awaitingBody" compact @generate="generate" @retry="retry">
        <template #last>
          {{ $t('component.youtube_article.ready_reload') }}
          <button type="button" class="yt-status-action" @click="emit('refresh-body')">{{ $t('component.youtube_article.show_article') }}</button>
        </template>
      </YoutubeArticleStatus>
    </div>
  </section>
</template>

<script lang="ts" setup>
import YoutubeArticleStatus from '~/components/Snapshot/YoutubeArticleStatus.vue'

import { PODCAST_EVENTS } from '~/utils/podcastMedia'

import { useYoutubeArticle } from '~/composables/bookmark/useYoutubeArticle'

// The slim status line of a YouTube bookmark whose body becomes the AI article (same idea as the
// podcast bar). It never shows the article itself: when the body holds it, the page swaps the body.
const props = defineProps<{
  bookmarkUid: string
  /** The body on screen already holds the article */
  bodyHasArticle: boolean
}>()

const emit = defineEmits<{
  /** The body on the server holds the article; load it in place */
  'refresh-body': []
  /** This bookmark keeps the raw transcript body (it has marks, or the body never arrived): show the article below it as before */
  fallback: []
}>()

const { state, acting, timedOut, isWorking, start, stop, generate, retry } = useYoutubeArticle(() => props.bookmarkUid, { loadContent: false })

const status = computed(() => state.value?.status ?? 'unavailable')
const visible = computed(() => !!state.value && status.value !== 'unavailable')
const awaitingBody = computed(() => status.value === 'ready' && !!state.value?.body_ready && !props.bodyHasArticle)

// Swapping the body restarts the video, so it waits while the video plays; then the reader decides
let playing = false
const onState = (e: Event) => {
  const wasPlaying = playing
  playing = !!(e as CustomEvent<{ playing: boolean }>).detail?.playing
  // A check that came while the video played was skipped; continue the checks when playback stops
  if (wasPlaying && !playing && !bodyTimer) askForBody()
}

// Ask a few times: the status can say ready a moment before this bookmark's body is written.
// The body that never arrives falls back to the article below the body.
const MAX_BODY_ATTEMPTS = 4
let bodyTimer: ReturnType<typeof setTimeout> | null = null
let bodyAttempts = 0
const askForBody = () => {
  if (bodyTimer) clearTimeout(bodyTimer)
  bodyTimer = null
  if (!awaitingBody.value || playing) return
  if (bodyAttempts >= MAX_BODY_ATTEMPTS) {
    emit('fallback')
    return
  }
  bodyAttempts++
  emit('refresh-body')
  bodyTimer = setTimeout(askForBody, 15_000)
}

watch(state, s => {
  if (!s || s.status === 'unavailable') return
  // Marks on the raw transcript keep it as the body; a ready article that is not the body (a visitor
  // in another language, or a body write that failed) is shown below the body
  if (s.body_mode === 'transcript' || (s.status === 'ready' && !s.body_ready && !props.bodyHasArticle)) emit('fallback')
})
watch(awaitingBody, value => {
  if (value) askForBody()
})

onMounted(() => {
  window.addEventListener(PODCAST_EVENTS.state, onState)
  void start()
})

onBeforeUnmount(() => {
  window.removeEventListener(PODCAST_EVENTS.state, onState)
  if (bodyTimer) clearTimeout(bodyTimer)
  stop()
})
</script>

<style lang="scss" scoped>
.youtube-article-bar {
  margin: 0 0 16px;
  color: var(--slax-text);
}

.yt-bar-status-region:empty {
  display: none;
}
</style>
