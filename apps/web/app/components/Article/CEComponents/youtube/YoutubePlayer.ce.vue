<template>
  <div class="slax-youtube">
    <div class="player-frame">
      <div ref="mountRef" class="player-mount"></div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void
  playVideo(): void
  getCurrentTime(): number
  destroy(): void
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer
}
type YTWindow = Window & {
  YT?: YTNamespace
  onYouTubeIframeAPIReady?: () => void
}

const props = defineProps<{
  videoId: string
}>()

const mountRef = ref<HTMLElement | null>(null)

let player: YTPlayer | null = null
let timer: ReturnType<typeof setInterval> | null = null

// 加载 YouTube IFrame API（全局仅一次），ready 后 resolve window.YT
const loadYoutubeApi = (): Promise<YTNamespace> => {
  const w = window as YTWindow
  if (w.YT && w.YT.Player) return Promise.resolve(w.YT)

  return new Promise<YTNamespace>(resolve => {
    if (!document.querySelector('script[data-slax-yt]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.setAttribute('data-slax-yt', '1')
      document.head.appendChild(s)
    }

    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev()
      if (w.YT) resolve(w.YT)
    }

    // 兜底：脚本已在别处加载完、回调已触发的情况，轮询拿到 YT
    const iv = setInterval(() => {
      if (w.YT && w.YT.Player) {
        clearInterval(iv)
        resolve(w.YT)
      }
    }, 200)
  })
}

const seekTo = (t: number) => {
  if (!player || typeof player.seekTo !== 'function') return
  player.seekTo(t, true)
  if (typeof player.playVideo === 'function') player.playVideo()
}

// 字幕面板点击 → 跳转
const onSeekRequest = (e: Event) => {
  const t = (e as CustomEvent<{ t: number }>).detail?.t
  if (typeof t === 'number') seekTo(t)
}

const stopSync = () => {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

// 轮询播放进度，向字幕面板广播当前时间
const startSync = () => {
  stopSync()
  timer = setInterval(() => {
    if (!player || typeof player.getCurrentTime !== 'function') return
    const now = player.getCurrentTime() || 0
    window.dispatchEvent(new CustomEvent('slax:youtube-time', { detail: { t: now } }))
  }, 300)
}

onMounted(async () => {
  if (typeof window === 'undefined' || !props.videoId) return
  window.addEventListener('slax:youtube-seek', onSeekRequest)
  const YT = await loadYoutubeApi()
  if (!mountRef.value) return
  player = new YT.Player(mountRef.value, {
    videoId: props.videoId,
    playerVars: { rel: 0, playsinline: 1 },
    events: { onReady: startSync }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('slax:youtube-seek', onSeekRequest)
  stopSync()
  if (player && typeof player.destroy === 'function') player.destroy()
  player = null
})
</script>

<style lang="scss" scoped>
.slax-youtube {
  margin: 24px 0;
}

.player-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: var(--slax-radius-sm, 10px);
  overflow: hidden;

  > * {
    width: 100%;
    height: 100%;
    border: 0;
  }
}
</style>
