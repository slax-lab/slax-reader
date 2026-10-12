<template>
  <section id="labs" class="settings-card lab-section" v-if="rows.length > 0">
    <div class="title">{{ $t('page.user.labs.title') }}</div>
    <p class="intro">{{ $t('page.user.labs.intro') }}</p>
    <div class="lab-list">
      <div class="lab-row" v-for="row in rows" :key="row.key">
        <div class="lab-text">
          <div class="lab-name">
            <span>{{ $t(`page.user.labs.${row.key}.name`) }}</span>
            <span class="lab-pill" :class="row.status">{{ $t(row.status === 'graduated' ? 'page.user.labs.status_graduated' : 'page.user.labs.status_active') }}</span>
          </div>
          <p class="lab-desc">{{ $t(`page.user.labs.${row.key}.desc`) }}</p>
        </div>
        <SwitchToggle :model-value="row.enabled" :disabled="row.status === 'graduated'" :loading="pending === row.key" @change="onToggle(row.key)" />
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import SwitchToggle from '~/components/SwitchToggle.vue'

import { useLabFeatures } from '~/composables/useLabFeatures'

const { te } = useI18n()
const labs = useLabFeatures()
const pending = ref<string | null>(null)

// 后端可以先于网页挂上一个新功能；没有文案的 key 不显示
const rows = computed(() => labs.features.value.filter(feature => te(`page.user.labs.${feature.key}.name`)))

onMounted(() => {
  labs.fetch()
})

const onToggle = async (key: string) => {
  if (pending.value) return
  pending.value = key
  try {
    await labs.toggle(key)
  } finally {
    pending.value = null
  }
}
</script>

<style lang="scss" scoped>
.settings-card {
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  padding: 24px;

  .title {
    font-family: var(--slax-font-serif);
    --style: font-600 text-(h2 txt) line-height-33px text-left select-none;
  }

  .intro {
    --style: mt-8px text-(card txt-light) line-height-22px;
  }

  .lab-list {
    --style: mt-16px flex flex-col;
  }

  .lab-row {
    --style: flex items-center justify-between gap-16px py-14px;
    border-top: 1px solid var(--slax-border);
  }

  .lab-text {
    --style: min-w-0 flex-1;
  }

  .lab-name {
    --style: flex items-center gap-8px text-(card txt) font-500 line-height-22px;
  }

  .lab-pill {
    --style: inline-flex items-center flex-none h-20px px-8px rounded-full text-tag;
    color: var(--slax-accent);
    background: var(--slax-accent-bg);

    &.graduated {
      color: var(--slax-text-light);
      background: color-mix(in srgb, var(--slax-text-light) 12%, transparent);
    }
  }

  .lab-desc {
    --style: mt-4px text-(tag txt-light) line-height-20px;
  }
}
</style>
