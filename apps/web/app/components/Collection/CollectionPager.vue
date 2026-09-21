<template>
  <!-- 页码选择器：NuxtLink 出 ?page=N（可爬） -->
  <!-- simple:恒显单数字,右箭头无限点 -->
  <nav v-if="simple || totalPages > 1" class="cp-pager" :aria-label="$t('page.c_index.pager_label')">
    <NuxtLink v-if="page > 1" class="cp-pager-arrow" :to="linkTo(page - 1)" :aria-label="$t('page.c_index.pager_prev')" rel="prev">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
    </NuxtLink>
    <span v-else class="cp-pager-arrow is-disabled" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 18l-6-6 6-6" /></svg>
    </span>

    <!-- simple:仅当前页 -->
    <span v-if="simple" class="cp-pager-num is-current" aria-current="page">{{ page }}</span>
    <template v-else>
      <span class="cp-pager-pages">
        <template v-for="item in items" :key="item.key">
          <template v-if="item.type === 'page'">
            <span v-if="item.value === page" class="cp-pager-num is-current is-mobile-visible" aria-current="page">{{ item.value }}</span>
            <NuxtLink v-else class="cp-pager-num" :class="{ 'is-mobile-visible': mobileNumbers.includes(item.value) }" :to="linkTo(item.value)">{{ item.value }}</NuxtLink>
          </template>
          <NuxtLink
            v-else
            class="cp-pager-ellipsis"
            :to="linkTo(item.target)"
            :aria-label="item.direction === 'prev' ? $t('page.c_index.pager_jump_prev') : $t('page.c_index.pager_jump_next')"
            :title="item.direction === 'prev' ? $t('page.c_index.pager_jump_prev') : $t('page.c_index.pager_jump_next')"
          >
            <span class="cp-pager-ellipsis-text" aria-hidden="true">…</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path v-if="item.direction === 'prev'" d="M13 6l-6 6 6 6M19 6l-6 6 6 6" />
              <path v-else d="M11 6l6 6-6 6M5 6l6 6-6 6" />
            </svg>
          </NuxtLink>
        </template>
      </span>
    </template>

    <NuxtLink v-if="simple || page < totalPages" class="cp-pager-arrow" :to="linkTo(page + 1)" :aria-label="$t('page.c_index.pager_next')" rel="next">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
    </NuxtLink>
    <span v-else class="cp-pager-arrow is-disabled" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18l6-6-6-6" /></svg>
    </span>
  </nav>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    page: number
    totalPages: number
    // 简易模式:单数字页码器
    simple?: boolean
  }>(),
  { simple: false }
)

type PagerItem =
  | { type: 'page'; value: number; key: string }
  | { type: 'ellipsis'; direction: 'prev' | 'next'; target: number; key: string }

const PAGER_COUNT = 7

const createPageItems = (): PagerItem[] => {
  const total = props.totalPages
  const current = Math.max(1, Math.min(props.page, total))
  if (total <= PAGER_COUNT) {
    return Array.from({ length: total }, (_, index) => ({ type: 'page', value: index + 1, key: `page-${index + 1}` }))
  }

  const page = (value: number): PagerItem => ({ type: 'page', value, key: `page-${value}` })
  const ellipsis = (direction: 'prev' | 'next', target: number): PagerItem => ({ type: 'ellipsis', direction, target, key: `ellipsis-${direction}` })

  if (current <= 4) {
    return [...Array.from({ length: 6 }, (_, index) => page(index + 1)), ellipsis('next', Math.min(total - 1, current + PAGER_COUNT - 2)), page(total)]
  }
  if (current >= total - 3) {
    return [page(1), ellipsis('prev', Math.max(2, current - PAGER_COUNT + 2)), ...Array.from({ length: 6 }, (_, index) => page(total - 5 + index))]
  }

  return [
    page(1),
    ellipsis('prev', Math.max(2, current - PAGER_COUNT + 2)),
    ...Array.from({ length: 5 }, (_, index) => page(current - 2 + index)),
    ellipsis('next', Math.min(total - 1, current + PAGER_COUNT - 2)),
    page(total)
  ]
}

const items = computed(createPageItems)

const mobileNumbers = computed(() => {
  const total = props.totalPages
  const current = Math.max(1, Math.min(props.page, total))
  const start = Math.max(1, current - 1)
  const end = Math.min(total, current + 1)
  return Array.from(new Set([1, ...Array.from({ length: end - start + 1 }, (_, index) => start + index), total]))
})

// page=1 不带 page 参数
const linkTo = (p: number) => (p <= 1 ? { query: {} } : { query: { page: String(p) } })
</script>

<style lang="scss" scoped>
.cp-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  max-width: 100%;
  margin-top: 48px;
}

.cp-pager-pages {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cp-pager-arrow,
.cp-pager-num,
.cp-pager-ellipsis {
  min-width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: color-mix(in srgb, var(--slax-text) 58%, var(--slax-text-muted));
  font-size: 14px;
  line-height: 1;
  text-decoration: none;
  transition: all var(--slax-dur-fast) ease;

  svg {
    width: 16px;
    height: 16px;
  }
}

.cp-pager-ellipsis {
  cursor: pointer;

  svg {
    display: none;
  }
}

.cp-pager-ellipsis:hover,
.cp-pager-ellipsis:focus-visible {
  .cp-pager-ellipsis-text {
    display: none;
  }

  svg {
    display: block;
  }
}

// 可点击项 hover
.cp-pager-arrow:not(.is-disabled):hover,
.cp-pager-num:not(.is-current):hover,
.cp-pager-ellipsis:hover,
.cp-pager-ellipsis:focus-visible {
  background: var(--slax-accent-bg);
  border-color: var(--slax-accent-soft);
  color: var(--slax-accent);
}

// 当前页 outline 高亮
.cp-pager-num.is-current {
  background: transparent;
  border-color: var(--slax-accent);
  color: var(--slax-accent);
  font-weight: 500;
  cursor: default;
}

.cp-pager-arrow.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

@media (max-width: 480px) {
  .cp-pager {
    gap: 4px;
    margin-top: 40px;
  }

  .cp-pager-pages {
    gap: 4px;
  }

  .cp-pager-num:not(.is-mobile-visible) {
    display: none;
  }

  .cp-pager-arrow,
  .cp-pager-num,
  .cp-pager-ellipsis {
    min-width: 32px;
    height: 32px;
    padding: 0 6px;
    font-size: 13px;
  }

  .cp-pager-arrow {
    padding: 0;
  }
}
</style>
