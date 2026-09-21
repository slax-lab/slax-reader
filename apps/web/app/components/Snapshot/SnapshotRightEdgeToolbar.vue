<template>
  <div v-if="!isH5 && !panelOpen && buttons.length > 0" class="edge-toolbar">
    <template v-for="(btn, idx) in buttons" :key="btn.id">
      <div v-if="idx > 0" class="edge-sep" />
      <button class="edge-btn" :class="{ active: modelValue === btn.id }" :title="btn.label" @click="toggle(btn.id)">
        <span class="edge-label">{{ btn.label }}</span>
        <span class="edge-icon" v-html="btn.icon" />
      </button>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { resolveSnapshotPanels, type SnapshotPanelId } from '~/components/Snapshot/panels'

const props = defineProps<{
  modelValue: SnapshotPanelId | null
  panelOpen?: boolean
  // 展示的面板子集，不传则全部
  panels?: SnapshotPanelId[]
}>()

const emits = defineEmits<{
  'update:modelValue': [value: SnapshotPanelId | null]
}>()

const { t } = useI18n()

const buttons = computed(() => resolveSnapshotPanels(props.panels, t))

const toggle = (id: SnapshotPanelId) => {
  emits('update:modelValue', props.modelValue === id ? null : id)
}

const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)
if (import.meta.client) {
  const onResize = () => {
    windowWidth.value = window.innerWidth
  }
  onMounted(() => window.addEventListener('resize', onResize))
  onUnmounted(() => window.removeEventListener('resize', onResize))
}
const isH5 = computed(() => windowWidth.value <= 768)
</script>

<style lang="scss" scoped>
.edge-toolbar {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-right: none;
  border-radius: var(--slax-radius-sm) 0 0 var(--slax-radius-sm);
  backdrop-filter: blur(12px);
  overflow: visible;
  z-index: 51;
  padding: 6px 0;

  .edge-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--slax-text-muted);
    transition: color 0.15s;

    &:hover {
      color: var(--slax-text);

      .edge-label {
        opacity: 1;
        transform: translateX(0);
        transition:
          transform 0.25s cubic-bezier(0.16, 1, 0.3, 1),
          opacity 0.1s;
      }
    }

    &.active {
      color: var(--slax-accent);
    }

    .edge-icon {
      position: relative;
      z-index: 2;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;

      :deep(svg) {
        width: 20px;
        height: 20px;
      }
    }

    .edge-label {
      position: absolute;
      right: 44px;
      top: 0;
      height: 100%;
      display: flex;
      align-items: center;
      padding: 0 14px 0 12px;
      background: var(--slax-surface);
      border: 1px solid var(--slax-border);
      border-right: none;
      border-radius: var(--slax-radius-sm) 0 0 var(--slax-radius-sm);
      backdrop-filter: blur(12px);
      font-size: 13px;
      color: var(--slax-text);
      white-space: nowrap;
      font-family: inherit;
      opacity: 0;
      transform: translateX(100%);
      pointer-events: none;
      transition:
        transform 0.2s ease-in,
        opacity 0.08s ease-in;
      z-index: -1;
    }
  }

  .edge-sep {
    width: 20px;
    height: 1px;
    background: var(--slax-border);
  }
}
</style>
