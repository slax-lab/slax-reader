<template>
  <div class="slax-podcast" :class="{ playing }">
    <img v-if="cover" class="cover" :src="cover" alt="" loading="lazy" />
    <div class="main">
      <div class="meta">
        <span class="title" :title="title">{{ title }}</span>
        <span v-if="show" class="show">{{ show }}</span>
      </div>
      <div class="controls">
        <button type="button" class="ctrl" :aria-label="t('component.podcast_player.back')" @click="skip(-15)">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 4 4 7.5 8 11" />
            <path d="M4.5 7.5H11a5 5 0 1 1-5 5" />
          </svg>
          <span class="skip-label">15</span>
        </button>
        <button type="button" class="ctrl play" :aria-label="playing ? t('component.podcast_player.pause') : t('component.podcast_player.play')" @click="toggle">
          <svg v-if="playing" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="5" y="4" width="3.2" height="12" rx="1" />
            <rect x="11.8" y="4" width="3.2" height="12" rx="1" />
          </svg>
          <svg v-else viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.2v11.6a.6.6 0 0 0 .9.5l9.2-5.8a.6.6 0 0 0 0-1L6.9 3.7a.6.6 0 0 0-.9.5Z" /></svg>
        </button>
        <button type="button" class="ctrl" :aria-label="t('component.podcast_player.forward')" @click="skip(15)">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M12 4l4 3.5-4 3.5" />
            <path d="M15.5 7.5H9a5 5 0 1 0 5 5" />
          </svg>
          <span class="skip-label">15</span>
        </button>
        <span class="time">{{ format(current) }}</span>
        <input
          class="progress"
          type="range"
          min="0"
          :max="duration || 0"
          step="1"
          :value="current"
          :aria-label="t('component.podcast_player.progress')"
          :style="{ '--p': duration ? `${(current / duration) * 100}%` : '0%' }"
          @input="onScrub"
        />
        <span class="time total">{{ format(duration) }}</span>
        <button type="button" class="ctrl rate" :aria-label="`${t('component.podcast_player.speed')} ${rate}×`" @click="nextRate">{{ rate }}×</button>
      </div>
      <button v-if="!following && playing" type="button" class="follow" @click="resumeFollow">{{ t('component.podcast_player.back_to_current') }}</button>
      <p v-if="error" class="error">{{ t('component.podcast_player.error') }}</p>
    </div>
    <audio
      ref="audioRef"
      :src="src"
      preload="metadata"
      @timeupdate="onTime"
      @play="onPlay"
      @pause="onPause"
      @loadedmetadata="onMeta"
      @error="error = true"
      @ended="onPause"
    ></audio>
  </div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { PODCAST_EVENTS, positionKey } from '~/utils/podcastMedia'

const props = defineProps<{
  src: string
  title?: string
  show?: string
  cover?: string
  durationMs?: string
}>()

const RATES = [1, 1.25, 1.5, 1.75, 2, 0.75]

const t = (key: string) => useNuxtApp().$i18n.t(key)

const audioRef = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const current = ref(0)
const duration = ref(Number(props.durationMs || 0) / 1000)
const rate = ref(1)
const following = ref(true)
const error = ref(false)

let lastSaved = 0
// A seek from the reader (time stamp, "listen from here") wins over the saved position
let userSeeked = false

const format = (sec: number): string => {
  const total = Math.max(0, Math.floor(sec || 0))
  const s = String(total % 60).padStart(2, '0')
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}:${s}`
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}`
}

const broadcast = () => {
  window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.time, { detail: { t: current.value, playing: playing.value } }))
}

const savePosition = (force = false) => {
  if (!props.src) return
  const now = Date.now()
  if (!force && now - lastSaved < 5000) return
  lastSaved = now
  try {
    // Near the start or the end there is nothing worth resuming
    if (current.value < 10 || (duration.value && current.value > duration.value - 10)) localStorage.removeItem(positionKey(props.src))
    else localStorage.setItem(positionKey(props.src), String(Math.floor(current.value)))
  } catch {
    // Private mode or full storage: resuming is a nicety
  }
}

// play() rejects with AbortError when a pause comes before it settles (a quick second click).
// Only a real media failure shows the error.
const playAudio = (audio: HTMLAudioElement) =>
  void audio.play().catch((err: unknown) => {
    if ((err as DOMException | null)?.name !== 'AbortError') error.value = true
  })

const seek = (sec: number, andPlay: boolean) => {
  const audio = audioRef.value
  if (!audio) return
  userSeeked = true
  audio.currentTime = Math.max(0, duration.value ? Math.min(sec, duration.value) : sec)
  current.value = audio.currentTime
  broadcast()
  if (andPlay) playAudio(audio)
}

const toggle = () => {
  const audio = audioRef.value
  if (!audio) return
  if (audio.paused) playAudio(audio)
  else audio.pause()
}

const skip = (delta: number) => seek(current.value + delta, false)

const nextRate = () => {
  rate.value = RATES[(RATES.indexOf(rate.value) + 1) % RATES.length] ?? 1
  if (audioRef.value) audioRef.value.playbackRate = rate.value
}

const onScrub = (e: Event) => seek(Number((e.target as HTMLInputElement).value), false)

const onTime = () => {
  current.value = audioRef.value?.currentTime ?? 0
  broadcast()
  savePosition()
}

const onPlay = () => {
  playing.value = true
  error.value = false
  following.value = true
  window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.follow, { detail: { following: true } }))
  window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.state, { detail: { playing: true } }))
  broadcast()
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
}

const onPause = () => {
  playing.value = false
  savePosition(true)
  window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.state, { detail: { playing: false } }))
  broadcast()
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
}

const onMeta = () => {
  const audio = audioRef.value
  if (!audio) return
  if (Number.isFinite(audio.duration) && audio.duration > 0) duration.value = audio.duration
  if (userSeeked || audio.currentTime >= 1) return
  try {
    const saved = Number(localStorage.getItem(positionKey(props.src)))
    if (saved > 10 && (!duration.value || saved < duration.value - 10)) {
      audio.currentTime = saved
      current.value = saved
    }
  } catch {
    // ignore
  }
}

// Seek requests from the text: time stamps, "listen from here", the transcript panel
const onSeekRequest = (e: Event) => {
  const sec = (e as CustomEvent<{ t: number }>).detail?.t
  if (typeof sec === 'number' && Number.isFinite(sec)) seek(sec, true)
}

const onFollow = (e: Event) => {
  following.value = !!(e as CustomEvent<{ following: boolean }>).detail?.following
}

const resumeFollow = () => {
  following.value = true
  window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.follow, { detail: { following: true, scroll: true } }))
}

const setupMediaSession = () => {
  if (!('mediaSession' in navigator)) return
  const ms = navigator.mediaSession
  ms.metadata = new MediaMetadata({ title: props.title || '', artist: props.show || '', artwork: props.cover ? [{ src: props.cover, sizes: '512x512' }] : [] })
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => void audioRef.value?.play()],
    ['pause', () => audioRef.value?.pause()],
    ['seekbackward', d => seek(current.value - (d.seekOffset ?? 15), false)],
    ['seekforward', d => seek(current.value + (d.seekOffset ?? 15), false)],
    ['seekto', d => typeof d.seekTime === 'number' && seek(d.seekTime, false)]
  ]
  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler)
    } catch {
      // Not every browser knows every action
    }
  }
}

onMounted(() => {
  window.addEventListener(PODCAST_EVENTS.seek, onSeekRequest)
  window.addEventListener(PODCAST_EVENTS.follow, onFollow)
  setupMediaSession()
})

onBeforeUnmount(() => {
  savePosition(true)
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null
    for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]) {
      try {
        navigator.mediaSession.setActionHandler(action, null)
      } catch {
        // ignore
      }
    }
  }
  window.removeEventListener(PODCAST_EVENTS.seek, onSeekRequest)
  window.removeEventListener(PODCAST_EVENTS.follow, onFollow)
  audioRef.value?.pause()
})
</script>

<!-- eslint-disable-next-line vue-scoped-css/enforce-style-type -- the shadow host needs a bare :host -->
<style lang="scss">
// Not scoped: a scoped `:host` compiles to `[data-v-x]:host`, which never matches the shadow host
:host {
  display: block;
  position: sticky;
  top: var(--slax-header-h-snapshot, 52px);
  z-index: 40;
  margin: 0 0 24px;

  @media (max-width: 768px) {
    top: var(--slax-header-h-mobile, 48px);
  }
}
</style>

<style lang="scss" scoped>
.slax-podcast {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm, 10px);
  background: var(--slax-surface-solid, #fff);
  box-shadow: 0 6px 20px color-mix(in srgb, var(--slax-text, #000) 8%, transparent);
  color: var(--slax-text);
  font-family: var(--slax-font-sans);
}

.cover {
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  object-fit: cover;

  @media (max-width: 768px) {
    display: none;
  }
}

.main {
  flex: 1 1 auto;
  min-width: 0;
}

.meta {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
  margin-bottom: 4px;
  font-size: 13px;
  line-height: 1.4;
}

.title {
  overflow: hidden;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.show {
  flex: 0 0 auto;
  max-width: 40%;
  overflow: hidden;
  color: var(--slax-text-light);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.controls {
  display: flex;
  gap: 6px;
  align-items: center;
}

.ctrl {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--slax-text);
  cursor: pointer;

  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  &:hover {
    background: var(--slax-accent-bg);
    color: var(--slax-accent);
  }

  &:focus-visible {
    outline: 2px solid var(--slax-accent);
  }
}

.skip-label {
  position: absolute;
  right: 1px;
  bottom: 1px;
  font-size: 8px;
  font-weight: 600;
}

.play {
  width: 36px;
  height: 36px;
  background: var(--slax-accent);
  color: var(--slax-surface-solid, #fff);

  svg {
    fill: currentColor;
    stroke: none;
  }

  &:hover {
    background: var(--slax-accent);
    color: var(--slax-surface-solid, #fff);
    opacity: 0.9;
  }
}

.time {
  flex: 0 0 auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--slax-text-light);
}

.progress {
  flex: 1 1 auto;
  min-width: 40px;
  height: 4px;
  margin: 0 4px;
  border-radius: 2px;
  background: linear-gradient(to right, var(--slax-accent) var(--p), var(--slax-border) var(--p));
  appearance: none;
  cursor: pointer;

  &::-webkit-slider-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--slax-accent);
    appearance: none;
  }

  &::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: 0;
    border-radius: 50%;
    background: var(--slax-accent);
  }
}

.rate {
  width: auto;
  min-width: 40px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.follow {
  margin-top: 6px;
  padding: 2px 10px;
  border: 1px solid var(--slax-accent);
  border-radius: 999px;
  background: var(--slax-accent-bg);
  color: var(--slax-accent);
  font-size: 12px;
  cursor: pointer;
}

.error {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--slax-text-light);
}

@media (max-width: 768px) {
  .time.total {
    display: none;
  }
}
</style>
