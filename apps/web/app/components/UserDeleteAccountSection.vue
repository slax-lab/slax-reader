<template>
  <section class="user-delete-account-section">
    <div class="info">
      <span class="description">{{ $t('page.user.delete_account.description') }}</span>
      <button class="delete-button" @click="openNoticeModal">
        {{ $t('page.user.delete_account.delete_button') }}
      </button>
    </div>

    <div class="delete-account-modal" :class="{ appear: noticeAppear }" v-if="showNoticeModal" @click="closeNoticeModal">
      <Transition name="modal" @after-leave="onNoticeAfterLeave">
        <div class="modal-content notice-modal" v-show="noticeAppear" @click.stop>
          <div class="header">
            <span class="modal-title">{{ $t('page.user.delete_account.dialog_title') }}</span>
            <button class="close" @click="closeNoticeModal" :disabled="isDeleting">
              <img src="@images/button-dialog-close.png" />
            </button>
          </div>
          <div class="notice-body">
            <ContentRenderer v-if="noticePage" :value="noticePage" />
            <div v-else class="loading-placeholder">
              <div class="i-svg-spinners:180-ring-with-bg text-3xl text-accent"></div>
            </div>
          </div>
          <div class="footer">
            <button class="btn-cancel" @click="closeNoticeModal" :disabled="isDeleting">
              {{ $t('page.user.delete_account.cancel_button') }}
            </button>
            <button class="btn-confirm" @click="openSecondConfirm" :disabled="isDeleting">
              {{ $t('page.user.delete_account.confirm_button') }}
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <div class="delete-account-modal" :class="{ appear: secondAppear }" v-if="showSecondConfirm" @click="closeSecondConfirm">
      <Transition name="modal" @after-leave="onSecondAfterLeave">
        <div class="modal-content second-modal" v-show="secondAppear" @click.stop>
          <div class="second-header">
            <span class="modal-title">{{ $t('page.user.delete_account.second_confirm_title') }}</span>
          </div>
          <div class="second-body">
            <p>{{ $t('page.user.delete_account.second_confirm_description') }}</p>
          </div>
          <div class="footer">
            <button class="btn-cancel" @click="closeSecondConfirm" :disabled="isDeleting">
              {{ $t('page.user.delete_account.cancel_button') }}
            </button>
            <button class="btn-confirm-final" @click="performDelete" :disabled="isDeleting">
              <Transition name="opacity" mode="out-in">
                <span v-if="!isDeleting" key="label">{{ $t('page.user.delete_account.second_confirm_button') }}</span>
                <span v-else key="loading" class="loading-inline">
                  <span class="i-svg-spinners:180-ring-with-bg text-16px"></span>
                  <span>{{ $t('page.user.delete_account.deleting') }}</span>
                </span>
              </Transition>
            </button>
          </div>
        </div>
      </Transition>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { RESTMethodPath } from '@slax-reader/contracts/const'
import Toast, { ToastType } from '~/components/Toast'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const userStore = useUserStore()
const auth = useAuth()

const showNoticeModal = ref(false)
const noticeAppear = ref(false)
const showSecondConfirm = ref(false)
const secondAppear = ref(false)
const isDeleting = ref(false)

const isLocked = useScrollLock(typeof window !== 'undefined' ? window : undefined)

const zhPage = ref<unknown>(null)
const enPage = ref<unknown>(null)
const noticeLoaded = ref(false)

const noticePage = computed(() => {
  return userStore.currentLocale === 'zh' ? zhPage.value : enPage.value
})

const ensureNoticeContent = async () => {
  if (noticeLoaded.value) return
  try {
    const [zh, en] = await Promise.all([
      queryCollection('open_docs_zh').path('/delete-account-notice').first(),
      queryCollection('open_docs_en').path('/delete-account-notice').first()
    ])
    zhPage.value = zh
    enPage.value = en
  } catch (e) {
    console.error('Failed to load delete-account-notice content', e)
  } finally {
    noticeLoaded.value = true
  }
}

const openNoticeModal = async () => {
  showNoticeModal.value = true
  isLocked.value = true
  ensureNoticeContent()
  await nextTick()
  noticeAppear.value = true
}

const closeNoticeModal = () => {
  if (isDeleting.value) return
  noticeAppear.value = false
}

const onNoticeAfterLeave = () => {
  showNoticeModal.value = false
  if (!showSecondConfirm.value) {
    isLocked.value = false
  }
}

const openSecondConfirm = async () => {
  if (isDeleting.value) return
  showSecondConfirm.value = true
  await nextTick()
  secondAppear.value = true
}

const closeSecondConfirm = () => {
  if (isDeleting.value) return
  secondAppear.value = false
}

const onSecondAfterLeave = () => {
  showSecondConfirm.value = false
  if (!showNoticeModal.value) {
    isLocked.value = false
  }
}

const performDelete = async () => {
  if (isDeleting.value) return
  isDeleting.value = true
  try {
    await request().post({
      url: RESTMethodPath.DELETE_MY_ACCOUNT
    })

    Toast.showToast({
      text: t('page.user.delete_account.delete_success'),
      type: ToastType.Success
    })

    await auth.clearAuth()
    secondAppear.value = false
    noticeAppear.value = false
    isLocked.value = false
    await navigateTo('/', { replace: true })
  } catch (e) {
    isDeleting.value = false
  }
}
</script>

<style lang="scss" scoped>
@use '~~/styles/markdown/content.scss' as markdownContent;

// 删除按钮使用 --slax-danger token，与 EditTag 等组件保持一致
.user-delete-account-section {
  --style: 'mt-60px pt-24px border-t-(1px solid border)';

  .info {
    --style: 'flex flex-wrap items-center gap-x-8px gap-y-4px';

    .description {
      --style: text-tag text-txt-light line-height-18px;
    }

    .delete-button {
      --style: 'p-0 bg-transparent border-none text-tag text-txt-light line-height-18px underline underline-border underline-offset-2 transition-colors duration-normal hover:(text-danger underline-danger) active:(scale-102)';
    }
  }
}

.delete-account-modal {
  --style: fixed inset-0 z-100 bg-transparent flex-center transition-colors duration-normal;
  &.appear {
    // 浮层遮罩半透明黑，跨主题保持不变（所有 modal 同款配方）
    --style: bg-#0f141999;
  }
}

.modal-content {
  --style: bg-surface-solid rounded-2 select-text relative overflow-hidden flex flex-col;
  // modal 专属下投阴影，与 AddUrlTopModal 一致沿用硬编码规格
  box-shadow: 0px 20px 60px 0px #0000001a;

  .header {
    --style: flex items-center justify-between px-24px py-20px border-b-(1px solid border);

    .modal-title {
      // 18px 不在 8 档内，按 task2 映射就近落 17px text-card
      --style: text-card text-txt line-height-25px font-600;
    }

    .close {
      --style: w-16px h-16px transition-opacity duration-normal hover: opacity-70 disabled: opacity-30;
      img {
        --style: w-full;
      }
    }
  }

  .footer {
    --style: flex justify-end items-center gap-12px px-24px py-16px border-t-(1px solid border);

    .btn-cancel {
      --style: 'px-20px h-36px rounded-8px border-(1px solid border) bg-surface-solid text-meta text-txt-muted font-500 transition-all duration-normal hover:(bg-accent-bg) disabled:(opacity-50 cursor-not-allowed)';
    }

    .btn-confirm {
      --style: 'px-20px h-36px rounded-8px border-none bg-danger text-meta text-txt-btn font-500 transition-all duration-normal hover:(opacity-85) disabled:(opacity-50 cursor-not-allowed)';
    }

    .btn-confirm-final {
      --style: 'px-20px h-36px rounded-8px border-none bg-danger text-meta text-txt-btn font-500 transition-all duration-normal flex-center min-w-140px hover:(opacity-85) disabled:(opacity-80 cursor-not-allowed)';

      .loading-inline {
        --style: flex items-center gap-8px;
      }
    }
  }
}

.notice-modal {
  --style: 'w-720px max-w-90vw max-h-85vh';

  .notice-body {
    --style: 'flex-1 overflow-y-auto px-32px py-24px';
    @include markdownContent.contentStyle;

    .loading-placeholder {
      --style: flex-center py-40px;
    }
  }
}

.second-modal {
  --style: 'w-440px max-w-90vw';

  .second-header {
    --style: px-24px pt-24px;

    .modal-title {
      --style: text-card text-danger line-height-25px font-600;
    }
  }

  .second-body {
    --style: px-24px pt-12px pb-24px;

    p {
      --style: text-meta text-txt-muted line-height-22px;
    }
  }
}

.modal-leave-to,
.modal-enter-from {
  --style: opacity-0 -translate-y-25px;
}

.modal-enter-active,
.modal-leave-active {
  --style: transition-all duration-normal ease-spring;
}

.opacity-leave-to,
.opacity-enter-from {
  --style: opacity-0;
}

.opacity-enter-active,
.opacity-leave-active {
  --style: transition-opacity duration-fast ease;
}
</style>
