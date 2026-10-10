<template>
  <div class="more-menu-wrap" ref="wrapEl">
    <button class="more-btn" :class="{ active: isOpen }" :title="$t('common.operate.more')" @click.stop="toggle">
      <AppIcon name="snapshot.more" :size="17" />
    </button>
    <Transition name="popover">
      <div v-if="isOpen" class="more-popover" v-on-click-outside="close">
        <button v-for="item in actions" :key="item.id" class="popover-item" :class="{ danger: item.danger }" @click="handleAction(item)">
          <span>{{ item.label }}</span>
          <AppIcon v-if="item.icon" class="item-icon" :name="item.icon" :size="15" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import AppIcon from '~/components/AppIcon.vue'

import { vOnClickOutside } from '@vueuse/components'
import { useExclusivePopover } from '~/composables/useExclusivePopover'
import type { IconKey } from '~/icons/registry'

export interface MoreMenuAction {
  id: string
  label: string
  icon?: IconKey
  danger?: boolean
}

defineProps<{
  actions: MoreMenuAction[]
}>()

const emits = defineEmits<{
  action: [action: MoreMenuAction]
}>()

const { isOpen, toggle, close } = useExclusivePopover()

const handleAction = (action: MoreMenuAction) => {
  emits('action', action)
  close()
}
</script>

<style lang="scss" scoped>
.more-menu-wrap {
  position: relative;
}

.more-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  color: var(--slax-text-light);
  background: transparent;

  &:hover,
  &.active {
    color: var(--slax-text);
    background: var(--slax-accent-bg);
  }
}

.more-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  padding: 6px;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-warm),
    0 12px 36px color-mix(in srgb, var(--slax-accent) 12%, transparent);
  z-index: 200;

  .popover-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 9px 12px;
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    color: var(--slax-text-muted);
    font-size: 13px;
    font-family: inherit;
    transition: all 0.12s;
    text-align: left;

    &:hover {
      background: var(--slax-accent-bg);
      color: var(--slax-text);
    }

    &.danger {
      color: var(--slax-danger);
    }

    .item-icon {
      width: 15px;
      height: 15px;
      opacity: 0.75;
      flex-shrink: 0;
    }
  }
}

.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.popover-enter-active,
.popover-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
</style>
