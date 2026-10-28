<template>
  <!-- Text bindings only: model output can never become markup -->
  <article ref="rootRef" class="podcast-translation" data-slax-derived="podcast-article" :lang="content.language">
    <p class="slax-yt-edition">{{ $t('component.podcast.edited_transcript') }}</p>
    <aside v-if="content.lede" class="slax-yt-introduction"><span class="slax-yt-label">{{ $t('component.podcast.introduction') }}</span><p>{{ content.lede }}</p></aside>
    <details class="slax-yt-contents" :open="!isH5">
      <summary>{{ $t('component.podcast.contents') }} <span>{{ content.sections.length }}</span></summary>
      <nav :aria-label="$t('component.podcast.contents')">
        <a v-for="(section, i) in content.sections" :key="i" :href="`#pod-translation-${i}`" @click.prevent="goToSection(i)"><span>{{ section.heading }}</span><time>{{ formatTime(section.start_ms) }}</time></a>
      </nav>
    </details>
    <section v-for="(section, i) in content.sections" :key="i" class="pod-tr-section">
      <h2 :id="`pod-translation-${i}`" class="pod-tr-heading slax-pod-heading">{{ section.heading }}</h2>
      <p v-for="(paragraph, j) in section.paragraphs" :key="j" class="pod-tr-p slax-pod-p" :data-start-ms="captionSource ? undefined : paragraph.start_ms">
        <a v-if="captionSource" class="pod-tr-time slax-pod-time" :href="`${captionSource}&t=${Math.floor(paragraph.start_ms / 1000)}`" target="_blank" rel="noopener noreferrer">{{ formatTime(paragraph.start_ms) }} ↗</a>
        <button v-else type="button" class="pod-tr-time slax-pod-time" :aria-label="$t('component.podcast.seek', { time: formatTime(paragraph.start_ms) })" @click="seekTo(paragraph.start_ms)">
          {{ formatTime(paragraph.start_ms) }}
        </button>
        <span v-if="paragraph.speaker" class="pod-tr-speaker slax-pod-speaker">{{ paragraph.speaker }}{{ content.language === 'zh' ? '：' : ':' }}</span>
        {{ paragraph.text }}
      </p>
    </section>
    <p v-if="captionSource" class="slax-yt-method">{{ content.language === 'zh' ? '转写来源：YouTube 字幕。时间戳打开视频。' : 'Transcript source: YouTube captions. Timestamps open the video.' }}</p>
    <footer class="slax-yt-method"><strong>{{ $t('component.podcast.method') }}</strong><p>{{ $t('component.podcast.method_note') }}</p></footer>
  </article>
</template>

<script lang="ts" setup>
import { MediaFollower, seekTo } from '~/utils/podcastMedia'

import type { PodcastTranslation } from '@slax-reader/contracts/interface'

const props = defineProps<{
  content: PodcastTranslation
}>()

const captionSource = computed(() => /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(props.content.transcript_source_url ?? '') ? props.content.transcript_source_url : null)
const rootRef = ref<HTMLElement | null>(null)
const { isH5 } = useSnapshotLayout()
const goToSection = (index: number) => rootRef.value?.querySelector(`#pod-translation-${index}`)?.scrollIntoView({ block: 'start' })
let follower: MediaFollower | null = null

const formatTime = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = String(total % 60).padStart(2, '0')
  const m = Math.floor(total / 60)
  if (m < 60) return `${String(m).padStart(2, '0')}:${s}`
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}`
}

onMounted(() => {
  follower = new MediaFollower(() => rootRef.value, '[data-start-ms]')
})

onBeforeUnmount(() => {
  follower?.destroy()
  follower = null
})
</script>

<style lang="scss" scoped>
@use "../../../styles/article/media-reading" as *;
@include media-reading;
.podcast-translation {
  margin: 0 0 24px;
  color: var(--slax-text);
  line-height: 1.8;
}



.pod-tr-heading {
  margin: 28px 0 12px;
  font-size: 1.25em;
  font-weight: 600;
  line-height: 1.4;
}

.pod-tr-p {
  margin: 0 -12px 12px;
  padding: 4px 12px;
  border-left: 2px solid transparent;
  border-radius: 6px;
  transition:
    background 0.2s ease,
    border-color 0.2s ease;
}

// Added at runtime by MediaFollower for the paragraph being heard
// eslint-disable-next-line vue-scoped-css/no-unused-selector
.pod-tr-p.slax-pod-playing {
  border-left-color: var(--slax-accent);
  background: var(--slax-accent-bg);
}

.pod-tr-time {
  margin-right: 8px;
  padding: 0 7px;
  border: 1px solid var(--slax-accent-soft);
  border-radius: 6px;
  background: var(--slax-accent-bg);
  color: var(--slax-accent);
  font-size: 0.75em;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1.7;
  vertical-align: 0.1em;
  cursor: pointer;

  &:hover {
    background: var(--slax-accent-soft);
  }
}

.pod-tr-speaker {
  margin-right: 4px;
  font-weight: 600;
}
</style>
