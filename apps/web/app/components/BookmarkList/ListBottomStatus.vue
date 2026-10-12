<template>
  <!-- 列表底部状态：加载中 / 已到末尾。未选话题或合集时不展示（占位选择态） -->
  <div class="bottom-status" v-if="showStatus">
    <TransitionGroup name="opacity">
      <div class="loading" v-if="showLoading">
        <div class="icon"></div>
        <span class="ml-5">{{ $t('page.bookmarks_index.more') }}</span>
      </div>
      <ListEndHint v-else-if="showEnding" :text="isInTrash ? $t('page.bookmarks_index.trash_no_more') : $t('page.bookmarks_index.no_more')" />
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import ListEndHint from '~/components/ListEndHint.vue'

const props = defineProps<{
  loading: boolean
  ending: boolean
  isRefreshLoading: boolean
  isInTrash: boolean
  filterStatus: string
  filterTopicIds: string[]
  filterCollectionId: number
}>()

// 复刻原 guard：话题/合集 tab 未选择具体 id 时，不展示底部状态（停留在选择占位态）
const showStatus = computed(() => !((props.filterStatus === 'topics' && props.filterTopicIds.length < 1) || (props.filterStatus === 'collections' && !props.filterCollectionId)))

// 延迟显示，避免闪烁
const DELAY = 500
const useDelayedTrue = (source: () => boolean) => {
  const shown = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  watch(
    source,
    val => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (val) timer = setTimeout(() => (shown.value = true), DELAY)
      else shown.value = false
    },
    { immediate: true }
  )
  onUnmounted(() => timer && clearTimeout(timer))
  return shown
}

const showLoading = useDelayedTrue(() => props.loading && !props.isRefreshLoading)
const showEnding = useDelayedTrue(() => !props.loading && props.ending)
</script>

<style lang="scss" scoped>
.bottom-status {
  --style: select-none relative shrink-0;
  padding: 48px 0 0;
  text-align: center;

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--slax-text-light);
    font-size: 13px;

    .icon {
      --style: 'i-svg-spinners:90-ring text-aux';
    }
  }
}
</style>
