<template>
  <div class="edit-tag-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <div class="header">
          <span>{{ t('component.edit_tag.title') }}</span>
          <button class="close" @click="closeModal">
            <img src="@images/button-dialog-close.png" />
          </button>
        </div>
        <div class="content">
          <textarea
            v-autofocus="{ enabled: appear }"
            v-ime-guard
            v-model="editname"
            :placeholder="tagName"
            v-on-key-stroke:Enter="[onKeyDown, { eventName: 'keydown' }]"
          ></textarea>
        </div>

        <!-- 正常态底部：删除 + 移出我的标签（仅 mine）+ 保存 -->
        <div class="bottom" v-if="!confirmingDelete">
          <button class="delete-btn" @click="confirmingDelete = true">{{ t('common.operate.delete') }}</button>
          <button class="demote-btn" v-if="source === 'mine'" @click="demoteTag">{{ t('component.tags_header.demote') }}</button>
          <button @click="submitTagName">{{ t('common.operate.save') }}</button>
        </div>

        <!-- 二次确认态底部：确认删除 -->
        <div class="bottom confirm-delete" v-else>
          <span class="confirm-text">{{ t('component.edit_tag.delete_confirm') }}</span>
          <div class="confirm-actions">
            <button class="cancel-btn" @click="confirmingDelete = false">{{ t('common.operate.cancel') }}</button>
            <button class="danger-btn" @click="deleteTag">{{ t('common.operate.confirm') }}</button>
          </div>
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
import type { BookmarkTag } from '@commons/types/interface'
import { vOnKeyStroke } from '@vueuse/components'
import Toast, { ToastType } from '~/components/Toast'

const props = defineProps({
  bookmarkId: Number,
  // REST 下是 hashid 字符串，local-first 下是 uuid；靠 idKind 区分
  tagId: [Number, String],
  tagName: String,
  source: {
    type: String as PropType<'auto' | 'mine'>,
    default: 'auto'
  },
  idKind: {
    type: String as PropType<'hashid' | 'uuid'>,
    default: 'hashid'
  }
})

const emits = defineEmits(['close', 'dismiss', 'success', 'delete', 'demote'])

// uuid 永远走 tag_uuid，绝不当 tag_id 发
const tagIdBody = () => (props.idKind === 'uuid' ? { tag_uuid: props.tagId } : { tag_id: props.tagId })

const isLoading = ref(false)
const isLocked = useScrollLock(window)
const appear = ref(false)
const editname = ref('')
const confirmingDelete = ref(false)

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
const submitTagName = () => {
  editTagName()
}
const editTagName = async () => {
  if (isLoading.value) {
    return
  }

  if (editname.value === props.tagName || editname.value.trim() === '') {
    closeModal()
    return
  }

  isLoading.value = true
  const req = {
    ...tagIdBody(),
    tag_name: editname.value
  }

  await request().post({
    url: RESTMethodPath.UPDATE_USER_TAG,
    body: req
  })

  isLoading.value = false
  closeModal()
  emits('success', props.tagId, editname.value)
}

const deleteTag = async () => {
  if (isLoading.value) {
    return
  }

  isLoading.value = true

  const res = await request().post<{ ok: boolean }>({
    url: RESTMethodPath.DELETE_USER_TAG,
    body: tagIdBody()
  })

  isLoading.value = false

  if (res) {
    closeModal()
    emits('delete', props.tagId)
  } else {
    Toast.showToast({
      text: t('common.tips.delete_tag_failed'),
      type: ToastType.Error
    })
  }
}

// 移出“我的标签”：降回 auto；本地行经 sync 回流
const demoteTag = async () => {
  if (isLoading.value) {
    return
  }

  isLoading.value = true

  const res = await request().post<BookmarkTag>({
    url: RESTMethodPath.DEMOTE_USER_TAG,
    body: tagIdBody()
  })

  isLoading.value = false

  if (res) {
    closeModal()
    emits('demote', props.tagId)
  } else {
    Toast.showToast({
      text: t('common.error.network'),
      type: ToastType.Error
    })
  }
}

const onAfterLeave = () => {
  isLocked.value = false
  emits('dismiss')
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Enter') {
    return
  }

  e.preventDefault()
  e.stopPropagation()
  submitTagName()
}

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}
</script>

<style lang="scss" scoped>
.edit-tag-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: transparent;
  transition: background 0.2s;

  &.appear {
    background: color-mix(in srgb, var(--slax-text) 22%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
}

.modal-content {
  width: 480px;
  max-width: 100%;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-warm),
    0 24px 64px color-mix(in srgb, var(--slax-accent) 16%, transparent),
    inset 0 1px 0 var(--slax-inset-hi);
  padding: 24px;
  position: relative;
  overflow: hidden;

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;

    span {
      font-family: var(--slax-font-serif);
      font-size: 17px;
      font-weight: 500;
      color: var(--slax-text);
      letter-spacing: 0.01em;
    }

    button.close {
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      border-radius: var(--slax-radius-sm);
      cursor: pointer;
      color: var(--slax-text-light);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;

      &:hover {
        background: var(--slax-surface);
        color: var(--slax-text);
        transform: none;
        opacity: 1;
      }

      img {
        width: 14px;
        height: 14px;
        object-fit: contain;
      }
    }
  }

  .content {
    margin-bottom: 20px;

    textarea {
      width: 100%;
      height: 72px;
      padding: 10px 14px;
      border: 1px solid var(--slax-border);
      border-radius: var(--slax-radius-sm);
      background: var(--slax-surface);
      color: var(--slax-text);
      font-size: 13px;
      font-family: inherit;
      line-height: 1.6;
      resize: none;
      outline: none;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;

      &:focus {
        border-color: var(--slax-accent);
        box-shadow: 0 0 0 3px var(--slax-accent-bg);
      }

      &::placeholder {
        color: var(--slax-text-light);
      }
    }
  }

  .bottom {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 16px;

    button:not(.delete-btn):not(.demote-btn):not(.cancel-btn):not(.danger-btn) {
      padding: 8px 18px;
      background: var(--slax-accent);
      color: var(--slax-btn-text);
      border: none;
      border-radius: var(--slax-radius-sm);
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;

      &:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }

      &:active {
        transform: scale(0.97);
      }
    }

    .delete-btn {
      padding: 0;
      background: transparent;
      color: var(--slax-text-light);
      border: none;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      transition: color 0.12s;

      &:hover {
        color: var(--slax-danger);
      }
    }

    .demote-btn {
      margin-right: auto;
      padding: 0;
      background: transparent;
      color: var(--slax-text-light);
      border: none;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      transition: color 0.12s;

      &:hover {
        color: var(--slax-accent);
      }
    }
  }

  .confirm-delete {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding: 12px 0 0;
    border-top: 1px solid var(--slax-border);

    .confirm-text {
      font-size: 13px;
      color: var(--slax-danger);
      line-height: 1.5;
    }

    .confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .cancel-btn {
      padding: 7px 14px;
      background: transparent;
      border: 1px solid var(--slax-border);
      border-radius: var(--slax-radius-sm);
      font-size: 13px;
      font-family: inherit;
      color: var(--slax-text-muted);
      cursor: pointer;
      transition: all 0.15s;

      &:hover {
        background: var(--slax-surface);
        color: var(--slax-text);
      }
    }

    .danger-btn {
      padding: 7px 14px;
      background: var(--slax-danger);
      color: #fff;
      border: none;
      border-radius: var(--slax-radius-sm);
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;

      &:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }
    }
  }
}

// 加载遮罩
.absolute {
  position: absolute;
}
.inset-0 {
  inset: 0;
}
.flex {
  display: flex;
}
.items-center {
  align-items: center;
}
.justify-center {
  justify-content: center;
}

.modal-leave-to,
.modal-enter-from {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}

.modal-enter-active,
.modal-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
