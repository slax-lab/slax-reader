<!-- 统一的标签 chip：标签页 / 添加面板 / 列表卡片共用 -->
<template>
  <span
    class="tag-chip"
    :class="{ mine: tag.source === 'mine', active, compact, legacy, [`variant-${effectiveVariant}`]: true, clickable: isClickable, 'has-acts': promotable || removable }"
    :title="tag.show_name"
    role="button"
    :tabindex="isClickable ? 0 : -1"
    @click.stop="emit('click', tag)"
    @keydown.enter.self.stop="emit('click', tag)"
  >
    <span class="tag-name">{{ tag.show_name }}</span>
    <span v-if="typeof count === 'number'" class="tag-count">{{ count }}</span>
    <i v-if="aiMark" class="tag-ai" :title="$t('component.bookmark_tags.by_ai')">AI</i>
    <!-- Actions sit in a gutter reserved on the right: the chip keeps its width on hover and nothing gets covered -->
    <span v-if="promotable || removable" class="tag-acts">
      <button
        v-if="promotable"
        class="tag-act promote"
        type="button"
        :title="$t('component.tags_header.promote')"
        :aria-label="$t('component.tags_header.promote')"
        @click.stop="emit('promote', tag)"
      >
        <svg v-if="effectiveVariant === 'topics'" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M6 10V2M3 5l3-3 3 3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <template v-else>↑</template>
      </button>
      <button
        v-if="removable"
        class="tag-act remove"
        type="button"
        :title="$t('common.operate.delete')"
        :aria-label="$t('common.operate.delete')"
        @click.stop="emit('remove', tag)"
      >
        <svg v-if="effectiveVariant === 'topics'" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
        </svg>
        <svg v-else-if="props.legacy" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
        <template v-else>×</template>
      </button>
    </span>
  </span>
</template>

<script lang="ts" setup>
import type { BookmarkTag } from '@commons/frontend-types/models'

const props = defineProps<{
  tag: BookmarkTag
  active?: boolean
  removable?: boolean
  promotable?: boolean
  aiMark?: boolean
  count?: number
  compact?: boolean
  variant?: 'topics' | 'list-card' | 'list-text'
  legacy?: boolean
  legacyInteractive?: boolean
}>()

const emit = defineEmits<{
  click: [tag: BookmarkTag]
  remove: [tag: BookmarkTag]
  promote: [tag: BookmarkTag]
}>()

const effectiveVariant = computed(() => props.variant ?? (props.legacy ? 'legacy' : 'topics'))
const { isClickable } = useTagChipInteraction(props)
void props
</script>

<style lang="scss" scoped>
.tag-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 4px 10px;
  border: 1px solid var(--slax-border);
  border-radius: 999px;
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  font-size: var(--slax-fs-tag);
  line-height: 1.5;
  white-space: nowrap;
  user-select: none;
  transition:
    background var(--slax-dur-normal),
    border-color var(--slax-dur-normal),
    color var(--slax-dur-normal);

  &.compact {
    padding: 2px 8px;
    gap: 4px;
  }

  &.mine {
    border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));
    background: var(--slax-accent-bg);
    color: var(--slax-accent);
  }

  &.active {
    border-color: var(--slax-accent);
    background: var(--slax-accent-bg);
    color: var(--slax-accent);
  }

  &.clickable {
    cursor: pointer;

    &:hover {
      border-color: color-mix(in srgb, var(--slax-accent) 40%, var(--slax-border));
    }
  }

  .tag-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag-count {
    font-size: 11px;
    opacity: 0.6;
  }

  .tag-ai {
    font:
      600 9px/1 ui-monospace,
      monospace;
    letter-spacing: 0.06em;
    padding: 2px 3px;
    border: 1px solid currentColor;
    border-radius: 3px;
    opacity: 0.55;
    font-style: normal;
  }

  // Chips with actions keep a gutter on the right at all times, so showing the buttons never changes the width
  &.has-acts {
    padding-right: 28px;
  }

  &.compact.has-acts {
    padding-right: 24px;
  }

  // Hidden, not display:none, so the buttons stay reachable by keyboard
  .tag-acts {
    display: inline-flex;
    visibility: hidden;
    position: absolute;
    top: 50%;
    right: 5px;
    transform: translateY(-50%);
    gap: 2px;
  }

  .tag-act {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid var(--slax-border-strong);
    border-radius: 50%;
    background: var(--slax-surface-solid);
    color: inherit;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;

    &:hover {
      border-color: var(--slax-accent);
      color: var(--slax-accent);
    }
  }

  &:hover .tag-acts,
  &:focus-within .tag-acts {
    visibility: visible;
  }

  // Topic actions are compact inline icons rather than circular controls.
  &.variant-topics {
    padding: 1px 9px;
    border: 1px solid var(--slax-border);
    border-radius: 20px;
    background: transparent;
    color: var(--slax-text-muted);
    font-size: 12px;
    line-height: 16px;

    // Variant geometry must not consume the action gutter or compact modifier.
    &.has-acts {
      padding-right: 28px;
    }

    &.compact {
      padding: 2px 8px;
      gap: 4px;
    }

    &.compact.has-acts {
      padding-right: 24px;
    }

    // Keep the filter state legible while the default topic surface stays transparent.
    &.mine,
    &.active {
      border-color: var(--slax-accent);
      background: var(--slax-accent-bg);
      color: var(--slax-accent);
    }

    .tag-acts {
      right: 6px;
      gap: 4px;
      visibility: visible;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--slax-dur-fast);
      // Offset the geometric cross to align optically with the tag text.
      transform: translateY(calc(-50% + 1.5px));
    }

    .tag-act {
      width: 12px;
      height: 12px;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--slax-text-light);
      font-size: 0;

      &:hover {
        border-color: transparent;
        color: var(--slax-accent);
      }

      &:focus-visible {
        outline: 2px solid var(--slax-accent);
        outline-offset: 2px;
      }
    }

    .tag-act.remove {
      width: 10px;
      height: 10px;
    }

    &:hover .tag-acts,
    &:focus-within .tag-acts {
      opacity: 1;
      pointer-events: auto;
    }
  }

  // List variants use the prototype's hidden inline × affordance: the action
  // sits in the flex flow (not absolutely positioned), so growing it on
  // hover actually expands the chip instead of overlapping the tag text.
  &.variant-list-card,
  &.variant-list-text {
    .tag-acts {
      position: static;
      top: auto;
      right: auto;
      transform: none;
      gap: 0;
      visibility: visible;
    }

    .tag-act {
      box-sizing: content-box;
      flex-shrink: 0;
      height: 14px;
      width: 0;
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: none;
      border-radius: 3px;
      background: none;
      color: var(--slax-text-light);
      opacity: 0;
      pointer-events: none;
      transition: width 0.15s, margin-left 0.15s, padding-left 0.15s, opacity 0.15s, color 0.15s;

      &:focus-visible {
        outline: 2px solid var(--slax-accent);
        outline-offset: 2px;
      }
    }

    &:hover .tag-act,
    &:focus-within .tag-act {
      width: 14px;
      margin-left: 6px;
      padding-left: 6px;
      border-left: 1px solid var(--slax-border);
      opacity: 1;
      pointer-events: auto;
    }

    .tag-act.remove {
      font-size: 14px;
      line-height: 14px;
    }
  }

  &.variant-list-card {
    padding: 1px 9px;
    border: 1px solid var(--slax-border);
    border-radius: 20px;
    background: transparent;
    color: var(--slax-text-muted);
    font-size: 12px;
    line-height: 16px;

    // Emphasize text without changing the border or background.
    &.clickable:hover,
    &:hover,
    &:focus-within {
      border-color: var(--slax-border);
      color: var(--slax-accent);
    }
  }

  &.variant-list-text {
    padding: 0 0 0 8px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--slax-text-light);
    font-size: 12px;
    font-weight: 300;
    line-height: 16px;

    &:hover,
    &:focus-within {
      color: var(--slax-accent);
    }

    // Text-mode uses a narrower close affordance than list-card chips.
    // Keep the shared visibility and interaction behavior, but match the
    // prototype's 12px control and 4px expansion gutter.
    .tag-act {
      height: 12px;
      font-size: 12px;
      line-height: 12px;
    }

    &:hover .tag-act,
    &:focus-within .tag-act {
      width: 12px;
      margin-left: 4px;
      padding-left: 0;
      border-left: 0;
    }

    .tag-act.remove {
      height: 12px;
      font-size: 12px;
      line-height: 12px;
    }

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 2px;
      width: 1px;
      height: 12px;
      background: var(--slax-border);
    }
  }

  // BookmarkTags 在标签改造前使用的方角、透明底样式。
  // 仅切换外观，保留当前 chip 的事件与多标签交互结构。
  &.legacy {
    gap: 0;
    padding: 4px 10px;
    border-color: var(--slax-border);
    border-radius: 6px;
    background: transparent;
    color: var(--slax-text-muted);
    font-size: 13px;
    cursor: default;

    &.clickable {
      cursor: pointer;

      &:hover {
        border-color: var(--slax-border);
      }
    }

    .tag-name {
      max-width: 150px;
    }

    .tag-ai {
      display: none;
    }

    &.has-acts,
    &.compact.has-acts {
      padding-right: 10px;
    }

    .tag-acts {
      position: static;
      top: auto;
      right: auto;
      transform: none;
      gap: 0;
    }

    .tag-act {
      box-sizing: content-box;
      flex-shrink: 0;
      height: 14px;
      width: 0;
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: none;
      border-left: 1px solid var(--slax-border);
      border-radius: 3px;
      background: none;
      color: var(--slax-text-light);
      opacity: 0;
      transition: all 0.15s;
    }

    &:hover .tag-act,
    &:focus-within .tag-act {
      width: 14px;
      margin-left: 6px;
      padding-left: 6px;
      opacity: 1;
    }
  }
}
@media (prefers-reduced-motion: reduce) {
  .tag-chip,
  .tag-chip .tag-acts,
  .tag-chip .tag-act {
    transition: none !important;
  }
}
</style>
