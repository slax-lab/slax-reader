<template>
  <div class="cancel-collection-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <!-- 标准 modal-header -->
        <div class="modal-header">
          <span class="modal-title">{{ t('component.cancel_collection_modal.title', { name: collection.collection_name }) }}</span>
          <button class="modal-close" type="button" @click="closeModal" aria-label="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 内容区 -->
        <div class="modal-body">
          <template v-if="!collection.is_free">
            <p class="modal-subtitle" v-if="subscribeEndTime">{{ t('component.cancel_collection_modal.subtitle', { date: subscribeEndTime }) }}</p>
            <div class="option-row" @click="isSelected = !isSelected">
              <button type="button" class="option-checkbox" :class="{ selected: isSelected }">
                <svg v-if="isSelected" viewBox="0 0 10 8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="1 4 3.5 6.5 9 1" />
                </svg>
              </button>
              <span>{{ t('component.cancel_collection_modal.removecollection') }}</span>
            </div>
          </template>
        </div>

        <!-- 操作按钮 -->
        <div class="modal-footer">
          <button class="btn-cancel" type="button" @click="closeModal">{{ t('common.operate.cancel') }}</button>
          <button class="btn-confirm" type="button" @click="cancelSubscribe" :disabled="isLoading">
            <span v-if="!isLoading">{{ t('common.operate.confirm') }}</span>
            <div v-else class="i-svg-spinners:180-ring-with-bg text-16px" style="color: var(--slax-btn-text)"></div>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { formatDate } from '@commons/utils/date'
import { RequestError } from '@commons/utils/request'

import type { UserSubscribeStatus } from '@commons/types/interface'
import { RESTMethodPath } from '@commons/types-pro'
import Toast, { ToastType } from '~/components/Toast'
import { useUserStore } from '~/stores/user'

const props = defineProps({
  collection: {
    type: Object as PropType<{
      collection_code: string
      collection_name: string
      is_free: number
      subscrition_end_time: string
    }>,
    required: true
  }
})

const emits = defineEmits(['close', 'dismiss', 'success'])

const isLoading = ref(false)
const isLocked = useScrollLock(window)
const appear = ref(false)
const isSelected = ref(false)
const subscribeInfo = ref<UserSubscribeStatus>()
const subscribeEndTime = computed(() => {
  const time = props.collection.subscrition_end_time ?? subscribeInfo.value?.end_time
  return time ? formatDate(new Date(time), 'YYYY-MM-DD') : ''
})

isLocked.value = true

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })
})

const checkSubscribed = async () => {
  const res = await useUserStore().getUserInfo()
  if (!res) return

  const subscribeRes = await request().post<UserSubscribeStatus>({
    url: RESTMethodPath.COLLECT_SUBSCRIBED,
    body: {
      collect_code: String(props.collection.collection_code)
    }
  })

  if (!subscribeRes) return

  subscribeInfo.value = subscribeRes
}

if (!props.collection.collection_code) {
  checkSubscribed()
}

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

const cancelSubscribe = async () => {
  isLoading.value = true

  try {
    const res = await request().post({
      url: RESTMethodPath.COLLECT_UNSUBSCRIBE,
      body: {
        collect_code: props.collection.collection_code,
        cancel_now: isSelected.value ? 1 : 0
      },
      errorInterceptors: err => {
        if (!(err instanceof RequestError && err.code === 400 && err.name === 'SHARE_COLLECTION_NOT_SUBSCRIBED')) {
          throw err
        }
      }
    })

    isLoading.value = false
    if (!res) {
      throw new Error('cancel subscribe failed')
    }

    closeModal()
    emits('success')
    Toast.showToast({
      text: t('common.tips.unsubscribe_success'),
      type: ToastType.Success
    })
  } catch (error) {
    if (error instanceof RequestError && error.code === 400 && error.name === 'SHARE_COLLECTION_NOT_SUBSCRIBED') {
      isLoading.value = false
      closeModal()
      emits('success')
      Toast.showToast({
        text: t('common.tips.unsubscribe_success'),
        type: ToastType.Success
      })
    } else {
      Toast.showToast({
        text: error instanceof RequestError ? error.message : `${error}` || `${error}`,
        type: ToastType.Error
      })
    }
  } finally {
    isLoading.value = false
  }
}

const t = (text: string, options: Record<string, string | number> = {}) => {
  return useNuxtApp().$i18n.t(text, options)
}
</script>

<style lang="scss" scoped>
/* ── Overlay ── */
.cancel-collection-modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: background var(--slax-dur-normal);

  &.appear {
    background: color-mix(in srgb, var(--slax-text) 22%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
}

/* ── Modal shell ── */
.modal-content {
  position: relative;
  width: min(420px, 92vw);
  max-height: 92vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-warm),
    0 24px 64px color-mix(in srgb, var(--slax-accent) 16%, transparent),
    inset 0 1px 0 var(--slax-inset-hi);
  user-select: none;
}

/* ── Header ── */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--slax-border);
  flex-shrink: 0;
}

.modal-title {
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-card);
  font-weight: 500;
  color: var(--slax-text);
  letter-spacing: -0.01em;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: calc(100% - 40px);
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  background: transparent;
  border: none;
  border-radius: var(--slax-radius-sm);
  color: var(--slax-text-light);
  cursor: pointer;
  transition: all var(--slax-dur-normal);

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
  }
}

/* ── Body ── */
.modal-body {
  padding: 24px 24px 8px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal-subtitle {
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-muted);
  line-height: 1.6;
  margin: 0;
}

.option-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;

  .option-checkbox {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 4px;
    background: var(--slax-surface-solid);
    border: 1.5px solid var(--slax-border);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all var(--slax-dur-normal);

    svg {
      display: none;
      width: 9px;
      height: 7px;
      color: var(--slax-btn-text);
      stroke-width: 2.5;
    }

    &.selected {
      background: var(--slax-accent);
      border-color: var(--slax-accent);
      box-shadow: 0 1px 3px color-mix(in srgb, var(--slax-accent) 30%, transparent);

      svg {
        display: block;
      }
    }

    &:hover:not(.selected) {
      border-color: var(--slax-accent);
      background: var(--slax-accent-bg);
    }
  }

  span {
    font-size: var(--slax-fs-aux);
    color: var(--slax-text);
    line-height: 1.5;
  }
}

/* ── Footer ── */
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px 20px;
}

.btn-cancel {
  font-family: inherit;
  font-size: var(--slax-fs-aux);
  font-weight: 500;
  color: var(--slax-text-muted);
  background: transparent;
  border: none;
  padding: 0 4px;
  cursor: pointer;
  transition: color var(--slax-dur-normal);

  &:hover {
    color: var(--slax-text);
  }
}

.btn-confirm {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 88px;
  height: 40px;
  padding: 0 20px;
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  border: none;
  border-radius: var(--slax-radius-sm);
  font-size: var(--slax-fs-aux);
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all var(--slax-dur-normal);

  &:hover:not(:disabled) {
    opacity: 0.92;
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
}

/* ── Modal transition ── */
.modal-leave-to,
.modal-enter-from {
  opacity: 0;
  transform: translateY(-20px) scale(0.97);
}

.modal-enter-active,
.modal-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
