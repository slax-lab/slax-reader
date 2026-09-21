<template>
  <div class="edit-name-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <div class="header">
          <span>{{ t('component.edit_name_modal.title') }}</span>
          <button class="close" @click="closeModal">
            <img src="@images/button-dialog-close.png" />
          </button>
        </div>
        <div class="content">
          <div class="title" v-if="props.name">{{ props.name }}</div>
          <textarea v-autofocus="{ enabled: appear }" v-model="editname" :placeholder="t('component.edit_name_modal.placeholder')"></textarea>
        </div>
        <div class="bottom">
          <button @click="submitBookmarkName">{{ t('common.operate.save') }}</button>
        </div>
        <Transition name="opacity">
          <!-- #f5f5f355 通用 UI 浅灰加载遮罩，保留 -->
          <div class="absolute inset-0 flex items-center justify-center bg-#f5f5f355" v-show="isLoading">
            <div class="i-svg-spinners:180-ring-with-bg text-3xl text-accent"></div>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { RESTMethodPath } from '@commons/types/const'

const props = defineProps({
  bookmarkId: Number,
  name: String,
  aliasName: String
})

const emits = defineEmits(['close', 'dismiss', 'success'])

const isLoading = ref(false)
const isLocked = useScrollLock(window)
const appear = ref(false)
const editname = ref(props.aliasName || '')

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
const submitBookmarkName = () => {
  editBookmarkName()
}
const editBookmarkName = async () => {
  if (isLoading.value) {
    return
  }

  if (editname.value === props.aliasName) {
    closeModal()
    return
  }

  isLoading.value = true
  const req = {
    bookmark_id: props.bookmarkId,
    alias_title: editname.value
  }

  await request().post({
    url: RESTMethodPath.BOOKMARK_ALIAS_TITLE,
    body: req
  })

  isLoading.value = false
  closeModal()
  emits('success', editname.value)
}
const onAfterLeave = () => {
  isLocked.value = false
  emits('dismiss')
}

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}
</script>

<style lang="scss" scoped>
.edit-name-modal {
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
  --style: bg-surface rounded-2 p-24px w-480px select-none mb-10 relative overflow-hidden;

  .header {
    --style: flex justify-between items-center;
    span {
      --style: text-(aux txt-light) line-height-18px;
    }

    button {
      --style: w-16px h-16px;
      img {
        --style: w-full;
      }
    }
  }

  .content {
    --style: mt-16px flex flex-col items-center justify-stretch;
    .title {
      --style: w-full text-(meta ellipsis txt) line-height-21px font-medium overflow-hidden line-clamp-2 break-all select-text;
    }

    .title + textarea {
      --style: mt-20px;
    }

    textarea {
      --style: w-full h-120px rounded-2 border-(1px solid #3333330d) text-(meta txt) bg-surface-solid line-height-22px py-12px px-16px resize-none outline-none;

      &::placeholder,
      &::-webkit-input-placeholder {
        --style: text-(meta txt-light);
      }
    }
  }

  .bottom {
    --style: mt-20px flex justify-end items-center;
    button {
      // #16B998 品牌绿（slax 主色）保存按钮底色，保留
      --style: flex-center w-100px h-40px bg-#16B998 rounded-2 text-(meta txt-btn) font-semibold line-height-40px transition-all duration-normal;

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

.modal-leave-to,
.modal-enter-from {
  --style: opacity-0 -translate-y-25px;
}

.modal-enter-active,
.modal-leave-active {
  --style: transition-all duration-normal ease-in-out;
}
</style>
