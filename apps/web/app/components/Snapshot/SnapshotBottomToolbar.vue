<template>
  <div class="bottom-toolbar" :class="{ 'h5-mode': isH5 }">
    <template v-for="(action, idx) in visibleActions" :key="action.id">
      <div v-if="idx > 0" class="toolbar-sep" />
      <button class="toolbar-btn" :class="{ active: action.active }" :title="action.label" @click="$emit('action', action, $event)">
        <span class="btn-icon" v-html="action.icon" />
        <span v-if="!isNarrow" class="btn-label">{{ action.label }}</span>
      </button>
    </template>
    <!-- 小屏：边缘侧栏隐藏，AI/Chat/评论 聚合到底部栏（对齐 snapshot demo 的 .bottom-tool.h5-only） -->
    <template v-if="isH5Mobile && panelButtons.length > 0">
      <template v-for="(panel, pIdx) in panelButtons" :key="panel.id">
        <div v-if="pIdx > 0 || visibleActions.length > 0" class="toolbar-sep" />
        <button class="toolbar-btn" :class="{ active: activePanel === panel.id }" :title="panel.label" @click="$emit('panel', panel.id)">
          <span class="btn-icon" v-html="panel.icon" />
          <span v-if="!isNarrow" class="btn-label">{{ panel.label }}</span>
        </button>
      </template>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { resolveSnapshotPanels, type SnapshotPanelId } from '~/components/Snapshot/panels'

export interface BottomToolbarAction {
  id: string
  icon: string
  label: string
  active?: boolean
  visible?: boolean
}

const props = defineProps<{
  actions: BottomToolbarAction[]
  // 小屏底部栏聚合的侧栏面板子集（不传则全部）；与右侧 edge toolbar 同源
  panels?: SnapshotPanelId[]
  activePanel?: SnapshotPanelId | null
}>()

defineEmits<{
  // 透传 MouseEvent，供定位光标 Toast
  action: [action: BottomToolbarAction, event: MouseEvent]
  panel: [id: SnapshotPanelId]
}>()

const { t } = useI18n()

const visibleActions = computed(() => props.actions.filter(a => a.visible !== false))
const panelButtons = computed(() => resolveSnapshotPanels(props.panels, t))

// H5 断点：≤768px 显示「更多」按钮；≤600px 只显图标
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)

if (import.meta.client) {
  const onResize = () => {
    windowWidth.value = window.innerWidth
  }
  onMounted(() => window.addEventListener('resize', onResize))
  onUnmounted(() => window.removeEventListener('resize', onResize))
}

const isH5 = computed(() => windowWidth.value <= 768)
const isH5Mobile = computed(() => windowWidth.value <= 768)
const isNarrow = computed(() => windowWidth.value <= 600)
</script>

<style lang="scss" scoped>
.bottom-toolbar {
  position: fixed;
  bottom: 24px;
  left: calc(50% - var(--slax-push-amount, 0px) / 2);
  transform: translateX(-50%);
  transition: left 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: 16px;
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  box-shadow: var(--slax-shadow-warm);
  z-index: 20;

  .toolbar-sep {
    width: 1px;
    height: 20px;
    background: var(--slax-border);
    margin: 0 4px;
    flex-shrink: 0;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: transparent;
    border: none;
    border-radius: var(--slax-radius-sm);
    cursor: pointer;
    color: var(--slax-text-muted);
    font-size: 13px;
    font-family: inherit;
    transition: all 0.15s;
    white-space: nowrap;

    &:hover {
      background: var(--slax-accent-bg);
      color: var(--slax-text);
    }

    &.active {
      color: var(--slax-accent);
    }

    .btn-icon {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;

      :deep(svg) {
        width: 18px;
        height: 18px;
      }
    }
  }

  // H5 ≤600px 只显图标
  &.h5-mode .btn-label {
    display: none;
  }
}
</style>
