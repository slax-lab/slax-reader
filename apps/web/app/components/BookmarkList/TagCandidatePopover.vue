<!-- 标签筛选页 “+” 的候选弹层：搜索 + 交集里还出现的标签（带剩余篇数） -->
<template>
  <!-- 忽略打开它的 “+”：click-outside 是 capture 阶段在 window 上跑的，不忽略的话 + 会先关再开 -->
  <div class="tag-candidate-popover" v-on-click-outside="[() => emit('close'), { ignore: ['.tag-add-filter'] }]" @keydown.escape.stop="emit('close')">
    <input v-autofocus v-ime-guard type="text" v-model="keyword" :placeholder="$t('component.tags_header.add_tag_placeholder')" />

    <div class="candidate-loading" v-if="loading">
      <div class="i-svg-spinners:90-ring w-16px" style="color: var(--slax-accent)"></div>
    </div>
    <!-- 改用 v-if div 包裹 v-for，避开 LF 异步列表的 patch 崩溃 -->
    <div class="candidate-list" v-else-if="filtered.length">
      <TagChip v-for="tag in filtered" :key="tag.id" :tag="tag" :count="tag.count" compact @click="emit('pick', tag)" />
    </div>
    <div class="candidate-empty" v-else>{{ $t('component.tags_header.no_candidates') }}</div>
  </div>
</template>

<script lang="ts" setup>
import TagChip from '~/components/BookmarkList/TagChip.vue'

import type { BookmarkTag } from '@commons/contracts/interface'
import { vOnClickOutside } from '@vueuse/components'

const props = defineProps<{
  selectedIds: string[]
  candidates: BookmarkTag[]
  loading?: boolean
}>()

const emit = defineEmits<{
  pick: [tag: BookmarkTag]
  close: []
}>()

const keyword = ref('')

// 子串过滤；后端 / 本地源已排除已选 id，这里再兜一层
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return props.candidates.filter(tag => !props.selectedIds.includes(String(tag.id)) && (!kw || tag.show_name.toLowerCase().includes(kw)))
})
</script>

<style lang="scss" scoped>
.tag-candidate-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: 300px;
  max-width: calc(100vw - 32px);
  padding: 10px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  background: var(--slax-surface-solid);
  box-shadow:
    var(--slax-shadow-warm),
    inset 0 1px 0 var(--slax-inset-hi);

  input {
    width: 100%;
    padding: 6px 10px;
    margin-bottom: 8px;
    border: 1px solid var(--slax-border);
    border-radius: var(--slax-radius-sm);
    background: var(--slax-surface);
    color: var(--slax-text);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;

    &:focus {
      border-color: var(--slax-accent);
    }

    &::placeholder {
      color: var(--slax-text-light);
    }
  }
}

.candidate-loading {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}

.candidate-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.candidate-empty {
  padding: 8px 2px;
  font-size: 12px;
  color: var(--slax-text-light);
}
</style>
