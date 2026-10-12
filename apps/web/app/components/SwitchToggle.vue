<template>
  <button
    type="button"
    class="switch-toggle"
    :class="{ on: modelValue, disabled }"
    role="switch"
    :aria-checked="modelValue"
    :aria-pressed="modelValue"
    :aria-busy="loading || undefined"
    :disabled="disabled"
    @click="onToggle"
  >
    <span class="knob" :class="{ loading }">
      <Transition name="opacity">
        <div class="i-svg-spinners:180-ring-with-bg text-tag text-accent" v-show="loading"></div>
      </Transition>
    </span>
  </button>
</template>

<script lang="ts" setup>
// A native <button> already toggles on Enter and Space; only the click path is handled here.
const props = defineProps<{
  modelValue: boolean
  loading?: boolean
  disabled?: boolean
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'change', value: boolean): void
}>()

const onToggle = () => {
  if (props.disabled || props.loading) return
  emits('update:modelValue', !props.modelValue)
  emits('change', !props.modelValue)
}
</script>

<style lang="scss" scoped>
.switch-toggle {
  // 开关关态：弱化文本色淡化底，开态填 accent；遵循 docs/DESIGN.md toggle 规范
  --style: relative flex-none w-36px h-20px rounded-full cursor-pointer transition-colors duration-normal p-0 border-none;
  background: color-mix(in srgb, var(--slax-text-light) 40%, transparent);

  &.on {
    background: var(--slax-accent);
  }

  &.disabled {
    --style: cursor-not-allowed opacity-60;
  }

  .knob {
    --style: absolute top-2px left-2px w-16px h-16px rounded-full flex-center transition-all duration-normal;
    background: var(--slax-surface-solid);
    box-shadow: var(--slax-shadow-sm);

    &.loading {
      --style: bg-transparent shadow-none;
    }
  }

  &.on .knob {
    --style: translate-x-16px;
  }
}
</style>
