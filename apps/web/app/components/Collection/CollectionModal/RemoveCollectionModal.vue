<template>
  <div class="remove-collection-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <div class="header">
          <span>{{ t('component.remove_collection_modal.title', { name: collection.collection_name }) }}</span>
        </div>
        <div class="bottom">
          <button @click="closeModal">{{ t('common.operate.cancel') }}</button>
          <button @click="removeSubscribe">{{ t('common.operate.confirm') }}</button>
        </div>
        <Transition name="opacity">
          <div class="absolute inset-0 flex items-center justify-center bg-[rgba(245,245,243,0.33)]" v-show="isLoading">
            <div class="i-svg-spinners:180-ring-with-bg text-3xl text-emerald"></div>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { RESTMethodPath } from '@commons/types-pro'
import Toast, { ToastType } from '~/components/Toast'

const props = defineProps({
  collection: {
    type: Object as PropType<{
      collection_code: string
      collection_name: string
    }>,
    required: true
  }
})

const emits = defineEmits(['close', 'dismiss', 'success'])

const isLoading = ref(false)
const isLocked = useScrollLock(window)
const appear = ref(false)

isLocked.value = true

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })
})

const closeModal = () => {
  if (isLoading.value) {
    return
  }

  appear.value = false
}

const onAfterLeave = () => {
  isLocked.value = false
  emits('dismiss')
}

const removeSubscribe = async () => {
  isLoading.value = true

  try {
    const res = await request().post({
      url: RESTMethodPath.COLLECT_DELETE_SUBSCRIBE,
      body: {
        collect_code: props.collection.collection_code
      }
    })

    isLoading.value = false
    if (!res) {
      throw new Error('remove subscribe failed')
    }

    closeModal()

    emits('success')
    Toast.showToast({
      text: t('common.tips.unsubscribe_success'),
      type: ToastType.Success
    })
  } catch (error) {
  } finally {
    isLoading.value = false
  }
}

const t = (text: string, options: Record<string, string | number> = {}) => {
  return useNuxtApp().$i18n.t(text, options)
}
</script>

<style lang="scss" scoped>
.remove-collection-modal {
  --style: fixed inset-0 z-100 bg-transparent flex-center transition-colors duration-250;
  &.appear {
    --style: bg-[rgba(var(--slax-modal-overlay-rgb), 0.6)];
  }
}

button {
  --style: 'hover:(scale-103 opacity-90) active:(scale-105) transition-all duration-250';
}

.modal-content {
  --style: bg-modal-warm-bg rounded-2 px-24px pb-24px pt-32px w-480px select-none mb-10 relative overflow-hidden;

  .header {
    --style: flex justify-between items-center;
    span {
      --style: text-(18px payment-text-primary) line-height-25px font-medium;
      font-family: var(--slax-font-serif);
    }
  }

  .bottom {
    --style: mt-20px flex justify-end items-center;

    button + button {
      --style: ml-32px;
    }

    button:nth-child(1) {
      --style: flex-center text-(13px payment-text-primary) line-height-18px transition-all duration-250;

      &:hover {
        --style: scale-103;
      }

      &:active {
        --style: scale-105;
      }
    }

    button:nth-child(2) {
      --style: flex-center w-100px h-40px bg-chart-primary rounded-2 text-(14px txt-btn) font-semibold line-height-40px transition-all duration-250;

      &:hover {
        --style: bg-payment-cta-hover;
      }

      &:active {
        --style: scale-105;
      }
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
