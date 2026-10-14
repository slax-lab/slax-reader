<template>
  <svg
    v-if="icon.kind === 'inline'"
    v-bind="$attrs"
    :class="props.class"
    :width="size"
    :height="size"
    :viewBox="icon.viewBox"
    :role="accessibilityAttrs.role"
    :aria-hidden="accessibilityAttrs.ariaHidden"
    :aria-label="accessibilityAttrs.label"
    v-html="icon.geometry"
  />
  <span
    v-else-if="icon.kind === 'mask'"
    v-bind="$attrs"
    :class="props.class"
    :style="[$attrs.style, maskStyle]"
    :role="accessibilityAttrs.role"
    :aria-hidden="accessibilityAttrs.ariaHidden"
    :aria-label="accessibilityAttrs.label"
  />
  <img
    v-else
    v-bind="$attrs"
    :class="props.class"
    :src="icon.source"
    :style="[$attrs.style, imageStyle]"
    :alt="accessibilityAttrs.label ?? ''"
    :aria-hidden="accessibilityAttrs.ariaHidden"
  />
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'

import { resolveIcon } from '~/icons/registry'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    label?: string
    class?: string
  }>(),
  { size: undefined, label: undefined, class: undefined }
)

const icon = computed(() => resolveIcon(props.name))
const size = computed(() => props.size ?? icon.value.defaultSize)
const cssSize = computed(() => (typeof size.value === 'number' ? `${size.value}px` : size.value))
const accessibleLabel = computed(() => (props.label === undefined ? icon.value.label : props.label)?.trim())

const accessibilityAttrs = computed(() => {
  if (icon.value.accessibility === 'standalone') {
    if (!accessibleLabel.value) {
      throw new Error(`[AppIcon] Standalone icon "${props.name}" requires an accessible label`)
    }
    return { role: 'img', ariaHidden: undefined, label: accessibleLabel.value }
  }
  return { role: undefined, ariaHidden: 'true' as const, label: undefined }
})

const maskStyle = computed(() => ({
  width: cssSize.value,
  height: cssSize.value,
  backgroundColor: 'currentColor',
  maskImage: `url(${icon.value.source})`,
  maskRepeat: 'no-repeat',
  maskPosition: 'center',
  maskSize: 'contain',
  WebkitMaskImage: `url(${icon.value.source})`,
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  WebkitMaskSize: 'contain'
}))

const imageStyle = computed<CSSProperties>(() => {
  if (icon.value.kind !== 'brand' && icon.value.kind !== 'raster') return {}
  return {
    width: cssSize.value,
    height: 'auto',
    aspectRatio: `${icon.value.intrinsicWidth} / ${icon.value.intrinsicHeight}`,
    objectFit: 'contain' as const
  }
})
</script>
