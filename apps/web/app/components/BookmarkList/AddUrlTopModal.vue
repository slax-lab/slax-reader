<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-backdrop" @click.self="closeModal">
        <div class="modal-dialog" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h3 class="modal-title">{{ $t('component.add_url_top_modal.add_url.title') }}</h3>
            <button class="modal-close" @click="closeModal" type="button" :aria-label="$t('common.operate.close')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p class="modal-desc">{{ $t('component.add_url_top_modal.add_url.placeholder') }}</p>
          <div class="modal-input-wrap" :class="{ error: showError }">
            <svg class="modal-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            <input
              v-autofocus
              v-ime-guard
              type="url"
              class="modal-input"
              v-model="addUrlText"
              :placeholder="$t('component.add_url_top_modal.add_url.placeholder')"
              autocomplete="off"
              @keydown.enter="topModalClick"
              @keydown.esc="closeModal"
              @input="showError = false"
            />
          </div>
          <p class="modal-error" v-if="showError">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {{ $t('component.add_url_top_modal.add_url.invalid_url') }}
          </p>
          <div class="modal-footer">
            <button class="modal-btn modal-btn-ghost" @click="closeModal" type="button">{{ $t('common.operate.cancel') }}</button>
            <button class="modal-btn modal-btn-primary" @click="topModalClick" :disabled="!addUrlButtonEnable || searchModalLoading" type="button">
              <div v-if="searchModalLoading" class="i-svg-spinners:90-ring h-14px w-14px"></div>
              <span v-else>{{ $t('component.add_url_top_modal.add_url.button') }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// add-url 支持 local-first
// 启用时本地写入，否则走 REST
import { isClient } from '@commons/utils/is'
import { haveRequestToken } from '~/utils/request'

import { useLocalBookmarks } from '@/composables/bookmark/useLocalBookmarks'
import { RESTMethodPath } from '@commons/types/const'
import Toast, { ToastType } from '~/components/Toast'
import { useLabFeatures } from '~/composables/useLabFeatures'

const show = defineModel('show')
const emits = defineEmits(['addUrlSuccess'])

const addUrlText = ref('')
const searchModalLoading = ref(false)
const showError = ref(false)

// 未启用时不触发查询，安全
const local = useLocalBookmarks()
// 客户端+登录+PowerSync 可用
const useLocalFirst = () => isClient && haveRequestToken() && isLocalFirstEnabled()
// 实验室开关：local-first 分支不经过服务端，写本地行之前先在这里拦
const labs = useLabFeatures()

watch(
  () => show.value,
  value => {
    if (value) {
      addUrlText.value = ''
      showError.value = false
      // 打开弹窗时拉一次开关列表，isBlocked 才有依据；拉不到就交给服务端置失败
      if (useLocalFirst() && !labs.loaded.value) labs.fetch().catch(() => {})
      // 聚焦交由 v-autofocus 指令处理
    }
  }
)

const trimmedUrl = computed(() => addUrlText.value.trim())

const addUrlButtonEnable = computed(() => {
  const url = trimmedUrl.value
  if (!url) return false
  return url.startsWith('http://') || url.startsWith('https://')
})

const topModalClick = async () => {
  if (!addUrlButtonEnable.value) {
    showError.value = true
    return
  }
  const targetUrl = trimmedUrl.value
  if (useLocalFirst() && labs.isBlocked(targetUrl)) {
    // 不写本地行：写了会同步上去、被服务端标失败，用户只看到一条失败书签
    labs.showBlockedToast(labs.blockedMessage(targetUrl))
    return
  }
  searchModalLoading.value = true
  try {
    if (useLocalFirst()) {
      // 本地写入，列表即时出现
      await local.createBookmark(targetUrl)
    } else {
      await request().post<{ bookmark_id: number; status: string }>({
        url: RESTMethodPath.ADD_URL_BOOKMARK,
        body: { target_url: targetUrl },
        // 替换全局的错误 toast：实验室拦截给一个带“去打开”的 toast，其余照旧只显示文案
        errorInterceptors: err => {
          if (labs.handleSaveError(err)) return
          Toast.showToast({ text: err instanceof Error ? err.message : String(err), type: ToastType.Error })
        }
      })
    }
  } catch {
    // 失败时弹窗留着，用户可以改链接再试
    return
  } finally {
    searchModalLoading.value = false
  }
  show.value = false
  emits('addUrlSuccess', targetUrl)
  addUrlText.value = ''
}

const closeModal = () => {
  show.value = false
}
</script>

<style lang="scss" scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--slax-text) 22%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.modal-dialog {
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
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.modal-title {
  font-family: var(--slax-font-serif);
  font-size: 18px;
  font-weight: 500;
  color: var(--slax-text);
  margin: 0;
  letter-spacing: 0.01em;
}

.modal-close {
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
  }
}

.modal-desc {
  font-size: 12px;
  color: var(--slax-text-light);
  margin: 0 0 16px;
  line-height: 1.6;
}

.modal-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;

  &:focus-within {
    border-color: var(--slax-accent);
    box-shadow: 0 0 0 3px var(--slax-accent-bg);
  }

  &.error {
    border-color: var(--slax-danger);
    background: var(--slax-danger-bg);
  }
}

.modal-input-icon {
  color: var(--slax-text-light);
  flex-shrink: 0;
}

.modal-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-family: inherit;
  font-size: 13px;
  color: var(--slax-text);
  min-width: 0;

  &::placeholder {
    color: var(--slax-text-light);
  }
}

.modal-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 2px 0;
  font-size: 12px;
  color: var(--slax-danger);
  line-height: 1.5;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.modal-btn {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 18px;
  border-radius: var(--slax-radius-sm);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.modal-btn-ghost {
  background: transparent;
  border-color: var(--slax-border);
  color: var(--slax-text-muted);

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
  }
}

.modal-btn-primary {
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  border-color: var(--slax-accent);

  &:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  &:disabled {
    background: color-mix(in srgb, var(--slax-accent) 35%, var(--slax-surface));
    border-color: transparent;
    color: color-mix(in srgb, var(--slax-btn-text) 70%, transparent);
    cursor: not-allowed;
  }
}

// 弹出动画
.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .modal-dialog {
    transform: scale(0.96) translateY(8px);
  }
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.22s ease;

  .modal-dialog {
    transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }
}
</style>
