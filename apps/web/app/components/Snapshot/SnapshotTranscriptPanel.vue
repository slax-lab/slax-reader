<template>
  <div class="snapshot-transcript-panel">
    <div class="panel-header">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="2.5" y="4.5" width="15" height="11" rx="2.5" />
        <path d="M5.5 9.75h4M5.5 12.5h6.5M12 9.75h2.5" />
      </svg>
      {{ $t('component.transcript_panel.title') }}
    </div>

    <div v-if="cues.length === 0" class="panel-empty">{{ $t('component.transcript_panel.empty') }}</div>

    <div v-else ref="listRef" class="transcript-list">
      <button v-for="(cue, i) in cues" :key="i" :ref="el => setCueRef(el, i)" type="button" class="cue" :class="{ active: i === activeIndex }" @click="onCueClick(cue.t)">
        <span class="cue-time">{{ formatTime(cue.t) }}</span>
        <span class="cue-text">{{ cue.text }}</span>
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

interface TranscriptCue {
  t: number
  text: string
}

const props = withDefaults(
  defineProps<{
    cues?: TranscriptCue[]
  }>(),
  { cues: () => [] }
)

const listRef = ref<HTMLElement | null>(null)
const cueRefs: (HTMLElement | null)[] = []
const activeIndex = ref(-1)

const setCueRef = (el: unknown, i: number) => {
  cueRefs[i] = (el as HTMLElement) ?? null
}

const formatTime = (sec: number): string => {
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0')
  const totalM = Math.floor(sec / 60)
  if (totalM < 60) return `${totalM}:${s}`
  const h = Math.floor(totalM / 60)
  const m = (totalM % 60).toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

// 点击字幕：通知文章内的 YouTube 播放器跳转
const onCueClick = (t: number) => {
  window.dispatchEvent(new CustomEvent('slax:youtube-seek', { detail: { t } }))
}

const scrollActiveIntoView = (idx: number) => {
  const list = listRef.value
  const el = cueRefs[idx]
  if (!list || !el) return
  const top = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2
  list.scrollTo({ top, behavior: 'smooth' })
}

// 播放器广播当前时间 → 高亮并居中当前字幕
const onPlayerTime = (e: Event) => {
  const now = (e as CustomEvent<{ t: number }>).detail?.t ?? 0
  const arr = props.cues
  let idx = -1
  for (let i = 0; i < arr.length; i++) {
    const cue = arr[i]
    if (cue && now >= cue.t) idx = i
    else break
  }
  if (idx !== activeIndex.value) {
    activeIndex.value = idx
    if (idx >= 0) scrollActiveIntoView(idx)
  }
}

onMounted(() => {
  window.addEventListener('slax:youtube-time', onPlayerTime)
})

onBeforeUnmount(() => {
  window.removeEventListener('slax:youtube-time', onPlayerTime)
})
</script>

<style lang="scss" scoped>
.snapshot-transcript-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--slax-text);
}

.panel-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 24px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--slax-accent);
  border-bottom: 1px solid var(--slax-border);

  svg {
    width: 18px;
    height: 18px;
  }
}

.panel-empty {
  padding: 24px;
  font-size: 14px;
  color: var(--slax-text-light);
}

.transcript-list {
  flex: 1 1 auto;
  position: relative;
  overflow-y: auto;
  padding: 8px;
  overscroll-behavior: contain;
}

.cue {
  display: flex;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  text-align: left;
  border: 0;
  border-left: 2px solid transparent;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: var(--slax-text);
  line-height: 1.5;
  transition: background 0.12s ease;

  &:hover {
    background: var(--slax-accent-bg);
  }

  &.active {
    background: var(--slax-accent-bg);
    border-left-color: var(--slax-accent);
  }
}

.cue-time {
  flex: 0 0 auto;
  min-width: 44px;
  padding-top: 1px;
  font-size: 12px;
  color: var(--slax-text-light);
  font-variant-numeric: tabular-nums;
}

.cue.active .cue-time {
  color: var(--slax-accent);
}

.cue-text {
  font-size: 14px;
}
</style>
