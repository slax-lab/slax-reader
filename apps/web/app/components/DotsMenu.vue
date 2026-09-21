<template>
  <div class="dots-menu" ref="dotsMenu">
    <button class="menu" @click="dotsClick"></button>
    <Transition name="operates">
      <div class="operates-container" v-show="isShowBubble" v-on-click-outside="outsideClick">
        <div class="operates">
          <div class="operate" v-for="action in actions" :key="action.id" @click="e => actionClick(e, action)">
            <span>{{ action.name }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts">
export interface DotsMenuActionItem {
  id: string
  name: string
}
</script>

<script setup lang="ts">
import { vOnClickOutside } from '@vueuse/components'

defineProps({
  actions: {
    type: Array as PropType<DotsMenuActionItem[]>,
    required: true
  }
})

const emits = defineEmits(['action'])

const dotsMenu = ref<HTMLDivElement>()
const isShowBubble = ref(false)

const outsideClick = () => {
  isShowBubble.value = false
}

const dotsClick = (e: Event) => {
  e.stopPropagation()

  isShowBubble.value = !isShowBubble.value
}

const actionClick = (e: Event, action: DotsMenuActionItem) => {
  e.stopPropagation()

  emits('action', action)
}
</script>

<style lang="scss" scoped>
.dots-menu {
  --style: relative flex;
  .menu {
    --style: 'w-16px h-16px bg-contain hover:(scale-103)';
    background-image: url('@images/menu-dots.png');
  }

  .operates-container {
    --style: absolute z-100 top-full -right-20px mt-8px;
    .operates {
      --style: min-w-100px p-4px bg-surface-solid rounded-8px border-(1px #3333330d solid) flex flex-col justify-center cursor-pointer overflow-hidden;
      box-shadow: 0px 20px 60px 0px #0000001a;

      .operate {
        --style: px-20px py-10px flex justify-center items-center rounded-8px cursor-pointer;

        &:has(span) {
          // bg-#3333330a 深色 hover 半透叠加，保留
          --style: 'transition-bg ease-in-out duration-300 hover:(bg-#3333330a)';
        }

        span {
          --style: text-(aux txt) line-height-18px font-500 whitespace-nowrap;
        }
      }
    }
  }
}

.operates-leave-to,
.operates-enter-from {
  --style: 'opacity-0 !h-0';
}

.operates-enter-active,
.operates-leave-active {
  --style: transition-all duration-normal ease-in-out;
}
</style>
