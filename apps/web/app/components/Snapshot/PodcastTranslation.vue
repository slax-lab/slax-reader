<template>
  <!-- Text bindings only: model output can never become markup -->
  <article ref="rootRef" class="podcast-translation" :lang="content.language">
    <p v-if="content.lede" class="pod-tr-lede">{{ content.lede }}</p>
    <section v-for="(section, i) in content.sections" :key="i" class="pod-tr-section">
      <h2 class="pod-tr-heading">{{ section.heading }}</h2>
      <p v-for="(paragraph, j) in section.paragraphs" :key="j" class="pod-tr-p" :data-start-ms="paragraph.start_ms">
        <button type="button" class="pod-tr-time" :aria-label="$t('component.podcast.seek', { time: formatTime(paragraph.start_ms) })" @click="seekTo(paragraph.start_ms)">
          {{ formatTime(paragraph.start_ms) }}
        </button>
        <span v-if="paragraph.speaker" class="pod-tr-speaker">{{ paragraph.speaker }}{{ content.language === 'zh' ? '：' : ':' }}</span>
        {{ paragraph.text }}
      </p>
    </section>
  </article>
</template>

<script lang="ts" setup>
import { MediaFollower, seekTo } from '~/utils/podcastMedia'

import type { PodcastTranslation } from '@slax-reader/contracts/interface'

defineProps<{
  content: PodcastTranslation
}>()

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
.podcast-translation {
  margin: 0 0 24px;
  color: var(--slax-text);
  line-height: 1.8;
}

.pod-tr-lede {
  margin: 0 0 24px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--slax-accent-bg);
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
