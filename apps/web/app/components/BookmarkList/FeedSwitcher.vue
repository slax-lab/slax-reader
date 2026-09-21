<template>
  <div class="feed-switcher" v-if="props.collections.length">
    <button class="feed-avatar" :class="{ active: !activeCode }" :title="$t('page.bookmarks_index.collection_feed.my_inbox')" @click="select(null)">
      <img :src="ownAvatar || defaultAvatar" :alt="$t('page.bookmarks_index.collection_feed.my_inbox')" />
    </button>
    <button
      v-for="c in props.collections"
      :key="c.code"
      :ref="setAvatarRef(c.code)"
      class="feed-avatar"
      :class="{ active: activeCode === c.code, 'has-new': c.has_new }"
      :title="c.name"
      @click="select(c.code)"
    >
      <img :src="c.avatar || defaultAvatar" :alt="c.name" />
    </button>
  </div>
</template>

<script lang="ts" setup>
import type { LocalCollectionItem } from '@/composables/bookmark/useLocalCollections'
import { useUserStore } from '~/stores/user'
import type { ComponentPublicInstance } from 'vue'

const props = defineProps<{ activeCode: string | null; collections: LocalCollectionItem[]; animateCode?: string | null; fadeCodes?: string[] }>()
const emits = defineEmits<{ (e: 'select', code: string | null): void; (e: 'animated', code: string): void }>()

const defaultAvatar = new URL('@images/user-default-avatar.png', import.meta.url).href
const ownAvatar = computed(() => useUserStore().userInfo?.picture || '')

const select = (code: string | null) => {
  if (code === props.activeCode) return
  emits('select', code)
}

// 头像 DOM 引用表，供命令式动画
const avatarEls = new Map<string, HTMLElement>()
const setAvatarRef = (code: string) => (el: Element | ComponentPublicInstance | null) => {
  if (el instanceof HTMLElement) avatarEls.set(code, el)
  else avatarEls.delete(code)
}

// WAAPI 命令式播放：不依赖 CSS 类/媒体查询，时机可控
let playing = ''
const playPop = (code: string, retry = 0) => {
  const el = avatarEls.get(code)
  if (!el || typeof el.animate !== 'function') {
    if (!el && retry < 3) return void requestAnimationFrame(() => playPop(code, retry + 1))
    return emits('animated', code) // 元素缺失/不支持：直接放行让父级清态
  }
  if (playing === code) return
  playing = code
  const done = () => {
    playing = ''
    emits('animated', code)
  }
  // 淡入长大到正常→继续放大过冲→弹簧衰减抖动→回到原大小
  el.animate(
    [
      { opacity: 0, transform: 'scale(0.4)', offset: 0 },
      { opacity: 1, transform: 'scale(1)', offset: 0.22 }, // 先到正常大小
      { transform: 'scale(1.45)', offset: 0.38 }, // 继续放大过冲
      { transform: 'scale(0.9)', offset: 0.54 }, // 回弹缩小
      { transform: 'scale(1.22)', offset: 0.68 },
      { transform: 'scale(0.96)', offset: 0.8 },
      { transform: 'scale(1.07)', offset: 0.9 },
      { transform: 'scale(1)', offset: 1 } // 衰减归位
    ],
    // delay：先让页面稳定再起播；backwards：延迟期间保持首帧(未出现)不闪
    { duration: 840, delay: 300, easing: 'ease-out', fill: 'backwards' }
  ).finished.then(done).catch(done)
}

watch(
  () => props.animateCode,
  async code => {
    if (!code) return
    await nextTick() // 等目标头像渲染进 DOM
    requestAnimationFrame(() => playPop(code)) // 等布局稳定再播
  },
  { immediate: true }
)

// 新增项淡入放大
// inFlight 防重播
const inFlightFade = new Set<string>()
const playFade = (code: string, retry = 0) => {
  const el = avatarEls.get(code)
  if (!el || typeof el.animate !== 'function') {
    if (!el && retry < 3) return void requestAnimationFrame(() => playFade(code, retry + 1))
    inFlightFade.delete(code)
    return emits('animated', code)
  }
  const done = () => {
    inFlightFade.delete(code)
    emits('animated', code)
  }
  el.animate([{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 320, easing: 'ease-out', fill: 'backwards' }).finished.then(done).catch(done)
}

watch(
  () => props.fadeCodes,
  async codes => {
    const list = codes || []
    for (const c of [...inFlightFade]) if (!list.includes(c)) inFlightFade.delete(c) // 离场即清可重播
    const fresh = list.filter(c => !inFlightFade.has(c) && c !== props.animateCode) // 让位弹簧
    if (!fresh.length) return
    await nextTick() // patch 后即播免闪
    for (const c of fresh) {
      inFlightFade.add(c)
      playFade(c)
    }
  },
  { immediate: true }
)
</script>

<style lang="scss" scoped>
.feed-switcher {
  --style: flex items-center gap-12px py-4px;

  .feed-avatar {
    --style: relative w-46px h-46px p-3px rounded-full bg-transparent cursor-pointer shrink-0;
    border: 1px solid transparent;
    transition:
      transform 0.15s,
      border-color 0.15s;

    img {
      --style: w-full h-full block rounded-full object-cover;
      background: var(--slax-border);
    }

    &:hover {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));
    }

    &.active {
      border-color: var(--slax-accent);
    }

    &.has-new::after {
      content: '';
      --style: absolute top-1px right-1px w-6px h-6px rounded-full;
      background: var(--slax-collection-unread);
      border: 1.5px solid var(--slax-bg, #fff);
      pointer-events: none;
    }
  }
}
</style>
