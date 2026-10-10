<!-- Article detail tags keep their presentation independent of topic and list chips. -->
<template>
  <span
    class="tag-chip-detail"
    :class="{ clickable: isClickable, 'has-acts': removable }"
    :title="tag.show_name"
    role="button"
    :tabindex="isClickable ? 0 : -1"
    @click.stop="emit('click', tag)"
    @keydown.enter.self.stop="emit('click', tag)"
  >
    <span class="tag-name">{{ tag.show_name }}</span>
    <span v-if="removable" class="tag-acts">
      <button class="tag-act remove" type="button" :title="$t('common.operate.delete')" :aria-label="$t('common.operate.delete')" @click.stop="emit('remove', tag)">×</button>
    </span>
  </span>
</template>

<script lang="ts" setup>
import type { BookmarkTag } from '@commons/frontend-types/models'

const props = defineProps<{
  tag: BookmarkTag
  removable?: boolean
  legacyInteractive?: boolean
}>()

const emit = defineEmits<{
  click: [tag: BookmarkTag]
  remove: [tag: BookmarkTag]
}>()

const { isClickable } = useTagChipInteraction({
  legacy: true,
  get legacyInteractive() {
    return props.legacyInteractive
  }
})
</script>

<style lang="scss" scoped>
// Match the detail prototype with a bordered chip and an expanding removal control.
.tag-chip-detail {
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 4px 10px;
  border: 1px solid var(--slax-border);
  border-radius: 6px;
  background: transparent;
  color: var(--slax-text-muted);
  font-size: 13px;
  line-height: 1.5;
  white-space: nowrap;
  user-select: none;
  cursor: default;
  transition: border-color var(--slax-dur-normal);

  &.clickable {
    cursor: pointer;

    &:hover {
      border-color: var(--slax-border);
    }
  }

  .tag-name {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &.has-acts {
    padding-right: 10px;
  }

  .tag-acts {
    display: inline-flex;
    gap: 0;
  }

  .tag-act {
    box-sizing: content-box;
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
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
    font-size: 13px;
    line-height: 1;
    opacity: 0;
    cursor: pointer;
    transition: all 0.15s;

    &:focus-visible {
      outline: 2px solid var(--slax-accent);
      outline-offset: 2px;
    }

    &:hover {
      color: var(--slax-accent);
    }
  }

  &:hover .tag-act,
  &:focus-within .tag-act {
    width: 14px;
    margin-left: 6px;
    padding-left: 6px;
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tag-chip-detail,
  .tag-chip-detail .tag-act {
    transition: none !important;
  }
}
</style>
