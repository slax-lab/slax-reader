<template>
  <ClientOnly>
    <div class="theme-switcher">
      <button
        v-for="t_ in themes"
        :key="t_.key"
        :class="['theme-btn', { active: colorMode.value === t_.key }]"
        :aria-pressed="colorMode.value === t_.key"
        :title="t(t_.i18nKey)"
        @click="setTheme(t_.key)"
      >
        <span class="theme-icon"><AppIcon :name="t_.icon" :size="14" /></span>
        <span class="sr-only">{{ t(t_.i18nKey) }}</span>
      </button>
    </div>

    <template #fallback>
      <div class="theme-switcher" aria-hidden="true">
        <div class="theme-btn-skeleton" />
      </div>
    </template>
  </ClientOnly>
</template>

<script lang="ts" setup>
import AppIcon from '~/components/AppIcon.vue'

import type { IconKey } from '~/icons/registry'
type ThemeKey = 'light' | 'dark' | 'eink'

const colorMode = useColorMode()
const t = (key: string) => useNuxtApp().$i18n.t(key)

const themes: { key: ThemeKey; i18nKey: string; icon: IconKey }[] = [
  {
    key: 'light',
    i18nKey: 'common.theme.light',
    icon: 'theme.light'
  },
  {
    key: 'dark',
    i18nKey: 'common.theme.dark',
    icon: 'theme.dark'
  },
  {
    key: 'eink',
    i18nKey: 'common.theme.eink',
    icon: 'theme.eink'
  }
]

const setTheme = (key: ThemeKey) => {
  colorMode.preference = key
}
</script>

<style lang="scss" scoped>
.theme-switcher {
  display: flex;
  align-items: center;
  overflow: hidden;
  border-radius: var(--slax-radius-sm);
  height: 28px;

  .theme-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    cursor: pointer;
    color: var(--slax-text-light);
    transition: all 0.2s;
    flex-shrink: 0;
    border-radius: 6px;

    &:hover {
      color: var(--slax-text);
    }

    &.active {
      color: var(--slax-accent);
    }

    // 非 active 按钮默认折叠
    &:not(.active) {
      width: 0;
      opacity: 0;
      padding: 0;
      overflow: hidden;
    }
  }

  // hover 时展开所有按钮
  &:hover .theme-btn:not(.active) {
    width: 28px;
    opacity: 1;
  }

  .theme-btn-skeleton {
    height: 28px;
    width: 28px;
    background: var(--slax-surface);
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
