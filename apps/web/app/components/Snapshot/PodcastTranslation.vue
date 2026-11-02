<template>
  <div class="podcast-translation">
    <!-- Text bindings keep model output separate from markup. -->
    <article ref="rootRef" data-slax-derived="podcast-article" :lang="content.language">
      <p class="slax-yt-edition">{{ $t('component.podcast.edited_transcript') }}</p>
      <aside v-if="content.lede" class="slax-yt-introduction">
        <span class="slax-yt-label">{{ $t('component.youtube_article.introduction') }}</span>
        <p>{{ content.lede }}</p>
      </aside>
      <details class="slax-yt-contents" :open="!isH5">
        <summary>{{ $t('component.youtube_article.contents') }} <span>{{ content.sections.length }}</span></summary>
        <nav :aria-label="$t('component.youtube_article.contents')">
          <a v-for="(section, i) in content.sections" :key="i" :href="`#pod-translated-topic-${i}`" @click.prevent="goToSection(i)">
            <span>{{ section.heading }}</span><time>{{ formatTime(section.start_ms) }}</time>
          </a>
        </nav>
      </details>
      <section v-for="(section, i) in content.sections" :key="i" class="slax-pod-section">
        <h2 :id="`pod-translated-topic-${i}`" class="slax-pod-heading">
          <span>{{ section.heading }}</span>
          <button type="button" class="slax-yt-chapter-time" :aria-label="$t('component.podcast.seek', { time: formatTime(section.start_ms) })" @click="seekTo(section.start_ms)">
            {{ formatTime(section.start_ms) }}
          </button>
        </h2>
        <p v-for="(paragraph, j) in section.paragraphs" :key="j" class="slax-pod-p" :data-start-ms="paragraph.start_ms">
          <span v-if="paragraph.speaker" class="slax-pod-speaker">{{ paragraph.speaker }}{{ content.language === 'zh' ? '：' : ':' }}</span>
          {{ paragraph.text }}
        </p>
      </section>
      <footer class="slax-yt-method"><strong>{{ $t('component.youtube_article.method') }}</strong><p>{{ $t('component.podcast.method_note') }}</p></footer>
    </article>
  </div>
</template>

<script lang="ts" setup>
import { MediaFollower, seekTo } from '~/utils/podcastMedia'

import type { PodcastTranslation } from '@slax-reader/contracts/interface'

defineProps<{
  content: PodcastTranslation
}>()

const { isH5 } = useSnapshotLayout()
const goToSection = (index: number) => rootRef.value?.querySelector(`#pod-translated-topic-${index}`)?.scrollIntoView({ block: 'start' })
const rootRef = ref<HTMLElement | null>(null)
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
@use "../../../styles/article/youtube-reading" as *;
.podcast-translation {
  @include youtube-reading;
  margin: 0 0 24px;
  color: var(--slax-text);

  // MediaFollower adds this class during playback.
  // eslint-disable-next-line vue-scoped-css/no-unused-selector
  .slax-pod-p.slax-pod-playing {
    border-left-color: var(--slax-accent);
    background: var(--slax-accent-bg);
  }
}
</style>
