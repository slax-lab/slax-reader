<template>
  <div class="snapshot-status-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <div class="header">
          <span>{{ title }}</span>
          <button class="close" @click="closeModal">
            <img src="@images/button-dialog-close.png" />
          </button>
        </div>
        <div class="content">
          <div class="message">{{ content }}</div>
        </div>
        <div class="bottom">
          <div class="checkbox-container">
            <input type="checkbox" id="dontRemind" v-model="dontRemindAgain" class="checkbox" />
            <label for="dontRemind" class="checkbox-label">
              {{ t('component.snapshot_status_modal.dont_remind_again') }}
            </label>
          </div>
          <div class="buttons">
            <button class="primary" @click="handleConfirm">{{ t('common.operate.confirm') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { BookmarkParseStatus } from '@commons/types/interface'

export interface SnapshotStatusModalProps {
  status: BookmarkParseStatus
  title: string
  content: string
  onDismiss?: () => void
  onConfirm?: (dontRemindAgain: boolean) => void
}

const props = defineProps<SnapshotStatusModalProps>()

const emits = defineEmits(['dismiss', 'confirm'])

const isLocked = useScrollLock(window)
const appear = ref(false)
const dontRemindAgain = ref(false)

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

isLocked.value = true

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })
})

const closeModal = () => {
  appear.value = false
}

const handleConfirm = () => {
  emits('confirm', dontRemindAgain.value)
  closeModal()
}

const onAfterLeave = () => {
  isLocked.value = false
  emits('dismiss')
}
</script>

<style lang="scss" scoped>
.snapshot-status-modal {
  --style: fixed inset-0 z-100 bg-transparent flex-center transition-colors duration-normal;
  &.appear {
    // #0f141999 通用 UI 蒙层（深灰半透），保留
    --style: bg-#0f141999;
  }
}

button {
  --style: 'hover:(scale-103 opacity-90) active:(scale-105) transition-all duration-normal';
}

.modal-content {
  --style: bg-surface rounded-2 p-24px w-480px select-none mb-10;
  position: relative;

  .header {
    --style: flex justify-between items-center;
    span {
      --style: text-(body txt) line-height-22px font-medium;
    }

    button {
      --style: w-16px h-16px;
      img {
        --style: w-full;
      }
    }
  }

  .content {
    --style: mt-20px;
    .message {
      --style: text-(meta txt-muted) line-height-20px;
    }
  }

  .bottom {
    --style: mt-24px flex flex-col gap-16px;

    .checkbox-container {
      --style: flex items-center gap-8px;

      .checkbox {
        --style: w-16px h-16px accent-#16B998;
      }

      .checkbox-label {
        --style: text-(aux txt-muted) line-height-18px cursor-pointer;
      }
    }

    .buttons {
      --style: flex justify-end;

      button.primary {
        // #16B998 品牌绿（slax 主色）确认按钮底色，保留
        --style: flex-center px-24px h-40px bg-#16B998 rounded-2 text-(meta txt-btn) font-semibold line-height-40px transition-all duration-normal;

        &:hover {
          // #14a689 品牌绿（slax 主色）按钮悬停态，保留
          --style: bg-#14a689;
        }

        &:active {
          --style: scale-105;
        }
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
  --style: transition-all duration-normal ease-in-out;
}
</style>
