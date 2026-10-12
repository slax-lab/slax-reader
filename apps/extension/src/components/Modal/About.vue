<template>
  <div class="about-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <div class="content">
          <img src="@/assets/app-logo-sm.png" alt="" />
          <span>Slax Reader {{ VERSION }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { useScrollLock } from '@vueuse/core'

const VERSION = `v${process.env.VERSION}`

const emits = defineEmits(['close', 'dismiss'])

const isLocked = useScrollLock(window)
const appear = ref(false)

isLocked.value = true

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })
})

const closeModal = () => {
  appear.value = false
}

const onAfterLeave = () => {
  isLocked.value = false
  emits('dismiss')
}
</script>

<style lang="scss" scoped>
.about-modal {
  --style: fixed inset-0 z-100 bg-transparent flex-center transition-colors duration-250;
  &.appear {
    --style: bg-#0f141999;
  }
}

.modal-content {
  --style: bg-#f5f5f3 rounded-2 p-24px w-480px select-none mb-10;
  position: relative;

  .content {
    --style: flex-center;

    img + span {
      --style: ml-10px;
    }

    span {
      --style: text-#000000 text-16px font-bold;
    }
  }
}

.modal-leave-to,
.modal-enter-from {
  --style: opacity-0 -translate-y-25px;
}

.modal-enter-active,
.modal-leave-active {
  --style: transition-all duration-250 ease-in-out;
}
</style>
