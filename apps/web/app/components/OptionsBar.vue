<template>
  <div class="options-bar">
    <div class="bar-container" @click="showOptions = !showOptions" v-on-click-outside="closePopup">
      <span class="title">{{ options[selectedIndex] }}</span>
      <svg class="arrow-icon" :class="{ open: showOptions }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
    <Transition name="operates">
      <div class="options-container" v-show="showOptions">
        <div class="options">
          <div class="option-wrapper" v-for="(item, index) in options" :key="index" @click="optionClick(index)">
            <span>{{ item }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { vOnClickOutside } from '@vueuse/components'

const props = defineProps({
  options: {
    required: true,
    type: Array as PropType<string[]>
  },
  defaultSelectedIndex: {
    required: false,
    type: Number,
    default: 0
  }
})

const emits = defineEmits(['optionSelected'])

const selectedIndex = defineModel<number>('index', { default: 0 })
const showOptions = ref(false)

selectedIndex.value = props.defaultSelectedIndex

watch(
  () => props.defaultSelectedIndex,
  newValue => {
    if (selectedIndex.value === newValue) {
      return
    }

    selectedIndex.value = newValue
  }
)

const optionClick = (index: number) => {
  if (index !== selectedIndex.value) {
    selectedIndex.value = index
    emits('optionSelected', index)
  }

  showOptions.value = false
}

const closePopup = () => {
  if (!showOptions.value) {
    return
  }

  showOptions.value = false
}
</script>

<style lang="scss" scoped>
.options-bar {
  --style: relative select-none;

  .bar-container {
    --style: bg-surface-solid relative z-11 pl-8px pr-6px max-w-200px overflow-hidden rounded-4px min-w-120px h-30px cursor-pointer flex items-center justify-between;
    border: 1px solid var(--slax-border);

    .title {
      --style: text-(meta txt) line-height-20px whitespace-nowrap overflow-hidden text-ellipsis;
    }

    .arrow-icon {
      --style: ml-5px shrink-0;
      transition: transform var(--slax-dur-normal);
      color: var(--slax-text-muted);

      &.open {
        transform: rotate(180deg);
      }
    }
  }

  .options-container {
    --style: absolute top-full right-0 pt-10px z-10;
    .options {
      --style: min-w-136px p-10px bg-surface-solid max-w-200px rounded-8px flex flex-col justify-center cursor-pointer overflow-hidden shadow-[0px_20px_100px_0px_#0000001a];
      border: 1px solid var(--slax-border);

      .option-wrapper {
        --style: 'h-40px flex justify-start items-center px-10px py-11px rounded-8px transition-bg ease-in-out duration-300';

        &:hover {
          background: var(--slax-accent-bg);
        }

        span {
          --style: text-(aux txt) line-height-18px font-500 whitespace-nowrap overflow-hidden text-ellipsis;
        }
      }
    }
  }
}

.operates-leave-to,
.operates-enter-from {
  --style: 'opacity-0';
}

.operates-enter-active,
.operates-leave-active {
  --style: transition-all duration-normal ease-in-out;
}
</style>
