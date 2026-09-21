<template>
  <div class="share-modal-modal" ref="modalBg" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <div class="header">
          <span>{{ $t('component.share_modal.title') }}</span>
        </div>
        <Transition name="tips">
          <div class="tips" v-show="isShowTips">
            <span>{{ $t('component.share_modal.revoke_tips') }}</span>
          </div>
        </Transition>
        <div class="content">
          <div class="title">{{ title }}</div>
          <Transition name="opacity">
            <div class="copy" v-show="shareLinkUrl">
              <div class="link">
                <span>{{ shareLinkUrl }}</span>
              </div>
              <button @click="copyLinkClick">{{ copyTitle }}</button>
            </div>
          </Transition>
          <div class="options">
            <div class="option" v-for="(option, index) in options" :key="index" @click="optionClick(index)">
              <button :class="{ selected: option.selected }"></button>
              <span>{{ option.title }}</span>
            </div>
          </div>
        </div>
        <Transition name="opacity">
          <div class="absolute inset-0 flex items-center justify-center bg-#f5f5f355" v-show="isLoading">
            <div class="i-svg-spinners:180-ring-with-bg text-3xl text-emerald"></div>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { copyText } from '@commons/utils/string'

import Toast, { ToastType } from '../Toast'
import { RESTMethodPath } from '@commons/types/const'
import type { ShareDetailInfo } from '@commons/types/interface'
import { onKeyStroke, useScrollLock } from '@vueuse/core'

const props = defineProps({
  bookmarkId: {
    type: Number,
    required: true
  },
  // 用于拼接 /b/{uuid} 链接
  bookmarkUuid: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  }
})

const emits = defineEmits(['dismiss', 'success', 'delete'])

const modalBg = ref<HTMLDivElement>()
const isLoading = ref(false)
const isLocked = useScrollLock(window)
const appear = ref(false)
const isShowTips = ref(false)
const copyTitle = ref($t('component.share_modal.copy_link'))
const shareLinkUrl = ref('')
const deleteShareLinkUrl = ref('')
// 不在 UI 暴露，update 时回传
const showUserinfo = ref(true)
// 单一开关，对齐 /b/[id]
const options = ref<{ title: string; selected: boolean }[]>([
  {
    title: $t('component.share_modal.options.first'),
    selected: true
  }
])

isLocked.value = true

onKeyStroke('Escape', e => {
  e.preventDefault()
  closeModal()
})

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })

  getShareInfo()
})

const getShareInfo = async () => {
  isLoading.value = true
  const res = await request.get<ShareDetailInfo>({
    url: RESTMethodPath.EXISTS_SHARE_BOOKMARK,
    query: {
      bookmark_uid: props.bookmarkUuid
    }
  })
  if (!res) {
    Toast.showToast({
      text: $t('common.tips.share_failed'),
      type: ToastType.Error
    })

    return
  }

  const [highlights] = options.value
  highlights.selected = res.show_comment_line
  showUserinfo.value = res.show_userinfo
  shareLinkUrl.value = getShareUrl()

  isLoading.value = false
}

const updateShare = async (params?: { selected?: boolean }) => {
  const [highlights] = options.value

  const selected = params?.selected ?? highlights.selected

  const res = await request.post<ShareDetailInfo>({
    url: RESTMethodPath.UPDATE_SHARE_BOOKMARK,
    body: {
      bookmark_uid: props.bookmarkUuid,
      show_comment_line: selected,
      show_userinfo: showUserinfo.value,
      allow_action: selected
    }
  })

  if (!res) {
    Toast.showToast({
      text: $t('common.tips.share_failed'),
      type: ToastType.Error
    })

    return
  }

  if (params) {
    highlights.selected = selected
  }

  shareLinkUrl.value = getShareUrl()
}

const closeShare = async () => {
  const res = await request.post<{ ok: boolean }>({
    url: RESTMethodPath.DELETE_SHARE_BOOKMARK,
    body: {
      bookmark_id: props.bookmarkId
    }
  })

  if (!res) {
    Toast.showToast({
      text: $t('common.tips.share_failed'),
      type: ToastType.Error
    })
  }

  deleteShareLinkUrl.value = shareLinkUrl.value
  // shareLinkUrl.value = ''
  options.value.forEach(option => {
    option.selected = false
  })
}

const getShareUrl = () => {
  return `${process.env.SHARE_BASE_URL}/b/${props.bookmarkUuid}`
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

const copyLinkClick = async (event: MouseEvent) => {
  await copyText(shareLinkUrl.value)

  Toast.showToast({
    text: $t('component.share_modal.copy_success')
  })
}

const optionClick = async (index: number) => {
  if (options.value.length <= index || index < 0) {
    return
  }

  const option = options.value[index]
  option.selected = !option.selected
  updateShare()
}
</script>

<style lang="scss" scoped>
.share-modal-modal {
  --style: fixed inset-0 z-100 bg-transparent flex-center transition-colors duration-250;
  &.appear {
    --style: bg-#0f141999;
  }
}

.modal-content {
  --style: bg-#f5f5f3 rounded-2 p-0px w-480px select-none mb-10 relative overflow-hidden;

  .header {
    --style: p-24px flex items-center justify-between bg-#FCFCFC;
    span {
      --style: text-(18px #333) line-height-25px font-500;
    }

    .switch {
      --style: cursor-pointer rounded-9px w-32px h-18px p-3px flex-center transition-colors duration-250 bg-#c5c6cb80;
      &:has(.open) {
        --style: bg-#16b998;
      }

      .ball {
        --style: w-14px h-14px rounded-full bg-#fff transition-all -translate-x-7px duration-250;
        &.open {
          --style: translate-x-7px;
        }

        &.loading {
          --style: bg-transparent;
        }
      }
    }
  }

  .tips {
    --style: bg-#FFF6E7 flex-center px-6px py-0 h-32px overflow-hidden;
    span {
      --style: text-(14px #f19943) line-height-20px;
    }
  }

  .content {
    --style: bg-#F5F5F3 pt-20px px-24px pb-32px;

    .title {
      --style: w-full text-(14px #333) line-height-21px font-500 whitespace-nowrap text-ellipsis overflow-hidden;
    }

    .copy {
      --style: mt-20px bg-#fff p-0 border-(2px #16b998 solid) rounded-8px flex items-center justify-between overflow-hidden transition-all duration-250;

      .link {
        --style: px-12px py-10p h-full flex-1 overflow-hidden transition-all duration-250;

        span {
          --style: relative block w-full whitespace-nowrap overflow-hidden text-(15px #333 ellipsis) line-height-21px select-all font-500;
          &:before {
            --style: content-empty bg-#999 w-full h-1px absolute top-1/2 left-0 transition-all duration-250 opacity-0;
          }
        }
      }

      button {
        --style: p-10px bg-#16B998 flex-center text-(14px #fff) font-600 min-w-76px transition-all duration-250;

        &:hover {
          --style: bg-#14a689;
        }

        &:active {
          --style: scale-105;
        }
      }

      &.close {
        --style: 'bg-transparent mt-5px !border-(0 transparent)';

        .link {
          --style: p-0;

          span {
            --style: text-#999 select-none;
            &:before {
              --style: opacity-100;
            }
          }
        }

        button {
          --style: opacity-0 invisible p-0;
        }
      }
    }

    .options {
      --style: mt-24px;

      .option {
        --style: 'flex items-center not-first:(mt-10px) cursor-pointer';

        button {
          --style: border-(1px solid #3333331a) bg-#fcfcfc w-12px h-12px rounded-3px transition-transform duration-250;

          &.selected {
            --style: 'bg-center bg-[length:7px_6px] border-1';
            background-image: url('@/assets/tiny-tick-outline-icon.png');
          }

          &:hover {
            --style: scale-105;
          }

          &:active {
            --style: scale-110;
          }
        }

        span {
          --style: ml-12px text-(15px #333) line-height-22px;
        }
      }
    }

    &.disabled {
      .title {
        --style: text-#999;
      }

      .options {
        .option {
          --style: cursor-auto;
          button {
            --style: bg-#f5f5f5 cursor-auto;
            &:hover,
            &:active {
              --style: scale-100;
            }
          }

          span {
            --style: text-#999;
          }
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
  --style: transition-all duration-250 ease-in-out;
}

.tips-leave-to,
.tips-enter-from {
  --style: '!h-0';
}

.tips-enter-active,
.tips-leave-active {
  --style: transition-all duration-250 ease-in-out;
}
</style>
