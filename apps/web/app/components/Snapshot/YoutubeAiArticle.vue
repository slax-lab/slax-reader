<template>
  <section v-if="visible" class="youtube-ai-article" :aria-busy="isWorking && !timedOut">
    <header class="yt-ai-header">
      <span class="yt-ai-title">{{ $t('component.youtube_article.title') }}</span>
      <span v-if="languageNote" class="yt-ai-note">{{ languageNote }}</span>
      <button v-if="isReady && hasTranscript" type="button" class="yt-ai-link" :aria-expanded="transcriptShown" @click="emit('toggle-transcript')">
        {{ transcriptShown ? $t('component.youtube_article.hide_transcript') : $t('component.youtube_article.show_transcript') }}
      </button>
    </header>

    <!-- One live region that stays in the DOM, so every status change is announced -->
    <div class="yt-ai-status-region" role="status" aria-live="polite">
      <YoutubeArticleStatus :state="state" :is-working="isWorking" :timed-out="timedOut" :acting="acting" :first="loadFailed" @generate="generate" @retry="retry">
        <template #first>
          {{ $t('component.youtube_article.load_failed') }}
          <button type="button" class="yt-status-action" @click="start">{{ $t('component.youtube_article.retry') }}</button>
        </template>
      </YoutubeArticleStatus>
    </div>

    <!-- Text bindings only: model output can never become markup -->
    <article v-if="isReady && article" class="yt-ai-body" :lang="article.language" :data-format="article.format">
      <p v-if="article.lede" class="yt-ai-lede">{{ article.lede }}</p>
      <section v-for="(section, i) in article.sections" :key="i" class="yt-ai-section">
        <h2 class="yt-ai-heading">
          <span>{{ section.heading }}</span>
          <button type="button" class="yt-ai-time" :aria-label="$t('component.youtube_article.seek', { time: formatTime(section.start_ms) })" @click="seek(section.start_ms)">
            {{ formatTime(section.start_ms) }}
          </button>
        </h2>
        <p v-for="(paragraph, j) in section.paragraphs" :key="j" class="yt-ai-paragraph">
          <span v-if="paragraph.speaker" class="yt-ai-speaker">{{ paragraph.speaker }}</span>
          {{ paragraph.text }}
        </p>
      </section>
    </article>
  </section>
</template>

<script lang="ts" setup>
import YoutubeArticleStatus from '~/components/Snapshot/YoutubeArticleStatus.vue'

import { useYoutubeArticle } from '~/composables/bookmark/useYoutubeArticle'

const props = withDefaults(
  defineProps<{
    bookmarkUid: string
    // Whether the original transcript in the article body is shown (parent owns the folding)
    transcriptShown?: boolean
    hasTranscript?: boolean
  }>(),
  { transcriptShown: false, hasTranscript: true }
)

const emit = defineEmits<{
  // true once an article is on screen; the parent folds the original transcript
  ready: [value: boolean]
  'toggle-transcript': []
}>()

const { t } = useI18n()
const { state, article, acting, timedOut, loadFailed, isWorking, start, stop, generate, retry } = useYoutubeArticle(() => props.bookmarkUid)

const status = computed(() => state.value?.status ?? 'unavailable')
const isReady = computed(() => status.value === 'ready' && !!article.value)
const visible = computed(() => loadFailed.value || (!!state.value && (status.value !== 'unavailable' || !!state.value.unavailable_reason)))

// A visitor may get the owner's language when theirs is not ready
const languageNote = computed(() => {
  const s = state.value
  if (!isReady.value || !s?.language || s.language === s.requested_language) return ''
  return t('component.youtube_article.language_note', { language: t(`component.youtube_article.lang.${s.language}`) })
})

watch(isReady, value => emit('ready', value))

// Chapter times seek the player (same event bridge as the transcript panel)
const seek = (ms: number) => {
  window.dispatchEvent(new CustomEvent('slax:youtube-seek', { detail: { t: Math.floor(ms / 1000) } }))
}

const formatTime = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = String(total % 60).padStart(2, '0')
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}:${s}`
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}`
}

onMounted(() => {
  void start()
})

onBeforeUnmount(() => {
  stop()
  // The parent folds the transcript while the article is shown; never leave it folded with no toggle
  if (isReady.value) emit('ready', false)
})
</script>

<style lang="scss" scoped>
.youtube-ai-article {
  margin: 28px 0 8px;
  padding: 20px 0 0;
  border-top: 1px solid var(--slax-border);
  color: var(--slax-text);
}

.yt-ai-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 12px;
}

.yt-ai-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--slax-accent);
}

.yt-ai-note {
  font-size: 12px;
  color: var(--slax-text-light);
}

.yt-ai-link {
  margin-left: auto;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 13px;
  color: var(--slax-accent);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.yt-ai-lede {
  margin: 0 0 20px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--slax-accent-bg);
  line-height: 1.7;
}

.yt-ai-section {
  margin: 0 0 20px;
}

.yt-ai-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 24px 0 10px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}

.yt-ai-time {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  color: var(--slax-accent);
  cursor: pointer;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }
}

.yt-ai-paragraph {
  margin: 0 0 14px;
  line-height: 1.8;
}

.yt-ai-speaker {
  margin-right: 4px;
  font-weight: 600;
}
</style>
