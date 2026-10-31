<template>
  <section v-if="visible" class="podcast-bar">
    <!-- One live region that stays in the DOM, so every status change is announced -->
    <div class="pod-status-region" role="status" aria-live="polite">
      <p v-if="stalled" class="pod-status">
        {{ $t('component.podcast.stalled') }}
        <button type="button" class="pod-action" @click="start">{{ $t('component.podcast.check_again') }}</button>
      </p>
      <p v-else-if="working && !notStarted" class="pod-status">
        <span class="i-svg-spinners:90-ring pod-spinner" aria-hidden="true"></span>
        {{ $t(`component.podcast.${phase}`) }}
      </p>
      <p v-else-if="phase === 'limit_reached' || notStarted" class="pod-status">
        {{ phase === 'limit_reached' ? $t('component.podcast.limit_reached') : $t('component.podcast.not_started') }}
        <button v-if="state?.can_retry" type="button" class="pod-action" :disabled="acting" @click="retry">{{ $t('component.podcast.start') }}</button>
      </p>
      <p v-else-if="phase === 'failed'" class="pod-status">
        {{ failureText }}
        <button v-if="state?.can_retry" type="button" class="pod-action" :disabled="acting" @click="retry">{{ $t('component.podcast.retry') }}</button>
      </p>
      <p v-else-if="keptBody" class="pod-status">
        {{ $t('component.podcast.kept_body') }}
      </p>
      <p v-else-if="awaitingBody" class="pod-status">
        {{ $t('component.podcast.ready_reload') }}
        <button type="button" class="pod-action" @click="emit('refresh-body')">{{ $t('component.podcast.show_article') }}</button>
      </p>
      <p v-else-if="translationWorking" class="pod-status">
        <span class="i-svg-spinners:90-ring pod-spinner" aria-hidden="true"></span>
        {{ $t('component.podcast.translating', { language: languageName(state?.translation?.language) }) }}
      </p>
      <p v-else-if="state?.translation?.status === 'failed'" class="pod-status">
        {{ $t('component.podcast.translation_failed') }}
        <button v-if="state?.can_retry" type="button" class="pod-action" :disabled="acting" @click="retry">{{ $t('component.podcast.retry') }}</button>
      </p>
    </div>

    <div v-if="translation && (bodyHasArticle || keptBody)" class="pod-switch" role="group" :aria-label="$t('component.podcast.view')">
      <button type="button" :class="{ active: mode === 'original' }" :aria-pressed="mode === 'original'" @click="setMode('original')">
        {{ $t('component.podcast.original') }}
      </button>
      <button type="button" :class="{ active: mode === 'translation' }" :aria-pressed="mode === 'translation'" @click="setMode('translation')">
        {{ $t('component.podcast.translation') }}
      </button>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { PODCAST_EVENTS } from '~/utils/podcastMedia'

import type { PodcastTranslation } from '@slax-reader/contracts/interface'
import { usePodcast } from '~/composables/bookmark/usePodcast'

const props = defineProps<{
  bookmarkUid: string
  /** The body on screen already is the cleaned transcript */
  bodyHasArticle: boolean
}>()

const mode = defineModel<'original' | 'translation'>('mode', { default: 'original' })

const emit = defineEmits<{
  /** The cleaned transcript is ready but the body on screen is the player-only one */
  'refresh-body': []
  translation: [value: PodcastTranslation | null]
  /** The original article to show below the body, when marks keep the show notes */
  article: [value: PodcastTranslation | null]
}>()

const { t } = useI18n()
const { state, translation, article, phase, acting, stalled, start, stop, retry } = usePodcast(() => props.bookmarkUid)

const visible = computed(() => phase.value !== 'hidden')
// The owner's episode that never started (daily limit reached when it was saved)
const notStarted = computed(() => state.value?.transcript === 'pending' && !!state.value?.can_retry)
const working = computed(() => phase.value === 'queued' || phase.value === 'transcribing' || phase.value === 'writing')
const translationWorking = computed(() => !!state.value?.translation && ['pending', 'generating', 'validating'].includes(state.value.translation.status))
const awaitingBody = computed(() => phase.value === 'done' && !!state.value?.body_ready && !props.bodyHasArticle)
// Marks keep the show notes as the body; the article shows below it, as for YouTube
const keptBody = computed(() => phase.value === 'done' && !props.bodyHasArticle && !!article.value)

const languageName = (lang?: string | null) => (lang ? t(`component.podcast.lang.${lang}`) : '')

const failureText = computed(() => {
  const reason = state.value?.reason ?? ''
  const key = `component.podcast.reason.${reason}`
  return reason && useNuxtApp().$i18n.te(key) ? t(key) : t('component.podcast.failed')
})

// The translation is the default view once it arrives (spec 第 1 节); the reader's choice wins after that
let chosen = false
const setMode = (next: 'original' | 'translation') => {
  chosen = true
  mode.value = next
}
watch(translation, value => emit('translation', value))
watch(article, value => emit('article', value))
watch([translation, () => props.bodyHasArticle || keptBody.value], ([value, hasArticle]) => {
  if (value && hasArticle && !chosen) mode.value = 'translation'
})

// The finished body replaces the player-only one at once, unless the audio is playing:
// swapping the body restarts the player, so then the reader decides
let playing = false
const onState = (e: Event) => {
  playing = !!(e as CustomEvent<{ playing: boolean }>).detail?.playing
}
// The status can say ready a moment before this bookmark's body is written: ask again a few times
let bodyTimer: ReturnType<typeof setTimeout> | null = null
let bodyAttempts = 0
const askForBody = () => {
  if (bodyTimer) clearTimeout(bodyTimer)
  bodyTimer = null
  if (!awaitingBody.value || playing || bodyAttempts >= 4) return
  bodyAttempts++
  emit('refresh-body')
  bodyTimer = setTimeout(askForBody, 15_000)
}
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
.podcast-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin: 0 0 16px;
  color: var(--slax-text);
}

.pod-status-region:empty {
  display: none;
}

.pod-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--slax-text-light);
}

.pod-spinner {
  width: 1em;
  height: 1em;
}

.pod-action {
  padding: 2px 12px;
  border: 1px solid var(--slax-accent);
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  color: var(--slax-accent);
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.pod-switch {
  display: inline-flex;
  margin-left: auto;
  padding: 2px;
  border: 1px solid var(--slax-border);
  border-radius: 8px;

  button {
    padding: 3px 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    font-size: 13px;
    color: var(--slax-text-light);
    cursor: pointer;

    &.active {
      background: var(--slax-accent-bg);
      color: var(--slax-accent);
      font-weight: 500;
    }
  }
}
</style>
