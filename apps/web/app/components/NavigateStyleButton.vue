<template>
  <button class="navigate-style-button" @click="buttonClick" :class="{ clickable }">
    <span class="nav-title">{{ title }}</span>
    <svg class="nav-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <polyline points="9 18 15 12 9 6" />
    </svg>
    <Transition name="opacity">
      <div class="loading" v-show="loading">
        <div class="i-svg-spinners:90-ring text-h2" style="color: var(--slax-accent)"></div>
      </div>
    </Transition>
  </button>
</template>

<script setup lang="ts">
const props = defineProps({
  title: {
    type: String,
    required: true
  },
  loading: {
    type: Boolean,
    required: false
  }
})

const emits = defineEmits(['action'])

const clickable = computed(() => {
  return !props.loading
})

const buttonClick = () => {
  if (props.loading) {
    return
  }

  emits('action')
}
</script>

<style lang="scss" scoped>
.navigate-style-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 14px 16px;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  overflow: hidden;
  text-align: left;

  &.clickable {
    cursor: pointer;
    transition:
      background var(--slax-dur-normal),
      border-color var(--slax-dur-normal),
      box-shadow var(--slax-dur-normal);

    &:hover {
      background: var(--slax-accent-bg);
      border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));

      .nav-arrow {
        transform: translateX(3px);
      }
    }

    &:active {
      background: color-mix(in srgb, var(--slax-accent) 10%, var(--slax-surface-solid));
    }
  }

  .nav-title {
    font-size: var(--slax-fs-body);
    font-weight: 500;
    color: var(--slax-accent);
    line-height: 1.4;
  }

  .nav-arrow {
    flex-shrink: 0;
    color: var(--slax-accent);
    opacity: 0.6;
    transition: transform var(--slax-dur-normal) var(--slax-ease-spring);
  }

  .loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--slax-surface-solid);
  }
}
</style>
