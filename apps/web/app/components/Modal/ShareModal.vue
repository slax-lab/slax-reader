<template>
  <div class="share-modal-modal" ref="modalBg" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <div class="header">
          <div class="title-group">
            <svg class="share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
            </svg>
            <span>{{ t('component.share_modal.title') }}</span>
          </div>
          <SwitchToggle class="switch" :model-value="isSwitched" :loading="isSwitchLoading" @change="switchClick" />
        </div>
        <Transition name="tips">
          <div class="tips" v-show="isShowTips">
            <svg class="tips-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span>{{ t('component.share_modal.revoke_tips') }}</span>
          </div>
        </Transition>
        <div class="content" :class="{ disabled: !isSwitched }">
          <div class="title">{{ title }}</div>
          <Transition name="opacity">
            <div class="copy" :class="{ close: !isSwitched }" v-show="shareLinkUrl">
              <div class="link">
                <span>{{ shareLinkUrl }}</span>
              </div>
              <button @click="copyLinkClick">
                <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
                <span>{{ copyTitle }}</span>
              </button>
            </div>
          </Transition>
          <div class="options">
            <div class="option" v-for="(option, index) in options" :key="index" @click="optionClick(index)">
              <span class="checkbox" :class="{ selected: option.selected }">
                <svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span>{{ option.title }}</span>
            </div>
          </div>
        </div>
        <Transition name="opacity">
          <div class="loading-mask" v-show="isLoading">
            <div class="i-svg-spinners:180-ring-with-bg text-3xl text-accent"></div>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts">
export enum ShareModalType {
  Bookmark = 'bookmark',
  Original = 'original'
}
</script>

<script lang="ts" setup>
import SwitchToggle from '~/components/SwitchToggle.vue'

import { copyText } from '@commons/frontend-utils/string'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { ShareDetailInfo } from '@slax-reader/contracts/interface'
import CursorToast from '~/components/CursorToast'
import Toast, { ToastType } from '~/components/Toast'

const props = defineProps({
  bookmarkId: {
    type: Number,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  type: {
    required: false,
    type: String,
    default: ShareModalType.Bookmark
  }
})

const $config = useRuntimeConfig().public

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const emits = defineEmits(['dismiss', 'success', 'delete'])

const modalBg = ref<HTMLDivElement>()
const isLoading = ref(false)
const isLocked = useScrollLock(window)
const appear = ref(false)
const isSwitched = ref(false)
const isSwitchLoading = ref(false)
const isShowTips = ref(false)
const copyTitle = ref(t('component.share_modal.copy_link'))
const shareLinkUrl = ref('')
const deleteShareLinkUrl = ref('')
type ShareOption = { title: string; selected: boolean }
const options = ref<[ShareOption, ShareOption, ShareOption]>([
  {
    title: t('component.share_modal.options.1'),
    selected: true
  },
  {
    title: t('component.share_modal.options.2'),
    selected: true
  },
  {
    title: t('component.share_modal.options.3'),
    selected: true
  }
])

isLocked.value = true

watch(
  () => isSwitched.value,
  value => {
    value && (copyTitle.value = t('component.share_modal.copy_link'))
  }
)

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })

  getShareInfo()
})

const getShareInfo = async () => {
  isLoading.value = true
  try {
    const res = await request().get<ShareDetailInfo>({
      url: RESTMethodPath.EXISTS_SHARE_BOOKMARK,
      query: {
        bookmark_id: String(props.bookmarkId)
      }
    })
    if (!res) {
      Toast.showToast({
        text: t('common.tips.share_failed'),
        type: ToastType.Error
      })
      isSwitched.value = false
      return
    }

    if (res.share_code.length === 0) {
      await updateShare({
        commentLine: true,
        userInfo: true,
        allowAction: true
      })

      isSwitched.value = true
      isLoading.value = false

      return
    }

    isSwitched.value = res.share_code.length > 0

    const [commentLine, userInfo, allowAction] = options.value
    commentLine.selected = res.show_comment_line
    userInfo.selected = res.show_userinfo
    allowAction.selected = res.allow_action
    if (isSwitched.value) {
      shareLinkUrl.value = getShareUrl(res.share_code)
    }
  } catch (error) {}

  isLoading.value = false
}

const updateShare = async (params?: { commentLine?: boolean; userInfo?: boolean; allowAction?: boolean }) => {
  const [commentLine, userInfo, allowAction] = options.value

  const showCommentLine = params?.commentLine ?? commentLine.selected
  const showUserinfo = params?.userInfo ?? userInfo.selected
  const allowActionSelected = params?.allowAction ?? allowAction.selected

  const res = await request().post<ShareDetailInfo>({
    url: RESTMethodPath.UPDATE_SHARE_BOOKMARK,
    body: {
      bookmark_id: props.bookmarkId,
      show_comment_line: showCommentLine,
      show_userinfo: showUserinfo,
      allow_action: allowActionSelected
    }
  })

  if (!res) {
    Toast.showToast({
      text: t('common.tips.share_failed'),
      type: ToastType.Error
    })

    return
  }

  if (params) {
    commentLine.selected = showCommentLine
    userInfo.selected = showUserinfo
    allowAction.selected = allowActionSelected
  }

  shareLinkUrl.value = getShareUrl(res.share_code)
}

const closeShare = async () => {
  const res = await request().post<{ ok: boolean }>({
    url: RESTMethodPath.DELETE_SHARE_BOOKMARK,
    body: {
      bookmark_id: props.bookmarkId
    }
  })

  if (!res) {
    Toast.showToast({
      text: t('common.tips.share_failed'),
      type: ToastType.Error
    })
  }

  deleteShareLinkUrl.value = shareLinkUrl.value
  // shareLinkUrl.value = ''
  options.value.forEach(option => {
    option.selected = false
  })
}

const getShareUrl = (hashcode: string) => {
  const concatString = props.type === ShareModalType.Original ? 'sw' : 's'
  return `${$config.SHARE_BASE_URL}/${concatString}/${hashcode}`
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

const switchClick = async () => {
  if (isSwitchLoading.value) {
    return
  }

  isSwitchLoading.value = true
  if (isSwitched.value) {
    await closeShare()
  } else {
    options.value.forEach(options => {
      options.selected = true
    })
    await updateShare()
  }

  isSwitched.value = !isSwitched.value
  isSwitchLoading.value = false

  isShowTips.value = !isSwitched.value
}

const copyLinkClick = async (event: MouseEvent) => {
  await copyText(shareLinkUrl.value)

  CursorToast.showToast({
    text: t('component.share_modal.copy_success'),
    trackDom: event.target as HTMLElement
  })
}

const optionClick = async (index: number) => {
  if (!isSwitched.value) {
    return
  }

  if (options.value.length <= index || index < 0) {
    return
  }

  const option = options.value[index]
  if (!option) {
    return
  }
  option.selected = !option.selected
  updateShare()
}
</script>

<style lang="scss" scoped>
.share-modal-modal {
  --style: fixed inset-0 z-200 bg-transparent flex-center transition-colors duration-normal;
  &.appear {
    // 遵循 docs/DESIGN.md 第八节弹窗遮罩规范
    background: rgba(15, 20, 25, 0.6);
    backdrop-filter: blur(4px);
  }
}

.modal-content {
  --style: select-none mb-10 relative overflow-hidden w-480px;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: var(--slax-shadow-modal);

  .header {
    --style: p-24px flex items-center justify-between;
    border-bottom: 1px solid var(--slax-border);

    .title-group {
      --style: flex items-center gap-10px;

      .share-icon {
        --style: w-18px h-18px flex-shrink-0;
        color: var(--slax-accent);
      }

      span {
        font-family: var(--slax-font-serif);
        font-size: var(--slax-fs-card);
        font-weight: 500;
        color: var(--slax-text);
        line-height: 1.4;
      }
    }
  }

  .tips {
    --style: flex items-center gap-8px px-24px py-0 h-36px overflow-hidden;
    background: var(--slax-accent-bg);

    .tips-icon {
      --style: w-15px h-15px flex-shrink-0;
      color: var(--slax-accent);
    }

    span {
      --style: text-meta line-height-20px;
      color: var(--slax-text-muted);
    }
  }

  .content {
    --style: pt-20px px-24px pb-32px;

    .title {
      --style: w-full text-(meta txt) line-height-21px font-500 whitespace-nowrap text-ellipsis overflow-hidden;
    }

    .copy {
      --style: mt-20px p-0 flex items-center justify-between overflow-hidden transition-all duration-normal;
      background: var(--slax-surface-solid);
      border: 1px solid var(--slax-border);
      border-radius: var(--slax-radius-sm);

      .link {
        --style: px-14px py-10px h-full flex-1 overflow-hidden transition-all duration-normal;

        span {
          --style: relative text-(meta txt ellipsis) line-height-21px select-all font-400;
          &:before {
            --style: content-empty bg-txt-light w-full h-1px absolute top-1/2 left-0 transition-all duration-normal opacity-0;
          }
        }
      }

      button {
        --style: flex items-center gap-6px px-14px py-10px self-stretch text-(aux txt-btn) font-500 flex-shrink-0 transition-all duration-normal;
        background: var(--slax-accent);

        .copy-icon {
          --style: w-14px h-14px;
        }

        &:hover {
          --style: -translate-y-px;
          box-shadow: 0 2px 8px color-mix(in srgb, var(--slax-accent) 25%, transparent);
        }

        &:active {
          --style: translate-y-0 scale-98;
        }
      }

      &.close {
        --style: 'bg-transparent mt-5px !border-(0 transparent)';

        .link {
          --style: p-0;

          span {
            --style: text-txt-light select-none;
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
        --style: 'flex items-center not-first:(mt-12px) cursor-pointer';

        .checkbox {
          --style: w-14px h-14px rounded-3px flex-center flex-shrink-0 transition-all duration-fast;
          background: transparent;
          border: 1px solid var(--slax-border);

          .tick {
            --style: w-9px h-9px opacity-0 transition-opacity duration-fast;
            color: var(--slax-accent);
          }

          &.selected {
            background: var(--slax-accent-bg);
            border-color: var(--slax-accent-soft);

            .tick {
              --style: opacity-70;
            }
          }
        }

        &:hover .checkbox:not(.selected) {
          border-color: var(--slax-accent-soft);
        }

        span {
          --style: ml-10px text-(meta txt) line-height-22px;
        }
      }
    }

    &.disabled {
      .title {
        --style: text-txt-light;
      }

      .options {
        .option {
          --style: cursor-auto;

          .checkbox {
            --style: cursor-auto;
            background: var(--slax-surface);
            border-color: var(--slax-border);
          }

          &:hover .checkbox:not(.selected) {
            border-color: var(--slax-border);
          }

          span {
            --style: text-txt-light;
          }
        }
      }
    }
  }

  .loading-mask {
    --style: absolute inset-0 flex-center;
    background: color-mix(in srgb, var(--slax-surface-solid) 80%, transparent);
  }
}

.modal-leave-to,
.modal-enter-from {
  --style: opacity-0 -translate-y-25px;
}

.modal-enter-active,
.modal-leave-active {
  --style: transition-all duration-normal;
  transition-timing-function: var(--slax-ease-spring);
}

.tips-leave-to,
.tips-enter-from {
  --style: '!h-0';
}

.tips-enter-active,
.tips-leave-active {
  --style: transition-all duration-normal ease-in-out;
}
</style>
