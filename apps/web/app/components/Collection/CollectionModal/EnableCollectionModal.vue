<template>
  <div class="enable-collection-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div v-show="appear" class="modal-content" :class="step === 'form' ? 'modal-form-dialog' : 'modal-result-dialog'" @click.stop>
        <!-- 表单态：填名称/描述后开启 -->
        <template v-if="step === 'form'">
          <div class="modal-header">
            <h3 class="modal-title">{{ t('page.bookmarks_index.starred_share.enable_modal.title') }}</h3>
          </div>

          <p class="modal-desc">{{ t('page.bookmarks_index.starred_share.enable_modal.desc') }}</p>

          <div class="modal-form">
            <div class="modal-field">
              <label class="modal-field-label" for="ecm-name">
                {{ t('page.collection_manage.name_label') }}
              </label>
              <input
                id="ecm-name"
                v-model="nameInput"
                class="modal-field-control modal-field-input"
                type="text"
                autocomplete="off"
                :placeholder="t('page.collection_manage.name_placeholder')"
              />
            </div>

            <div class="modal-field">
              <label class="modal-field-label" for="ecm-desc">
                {{ t('page.collection_manage.desc_label') }}
                <span>{{ t('page.collection_manage.optional') }}</span>
              </label>
              <textarea
                id="ecm-desc"
                ref="descRef"
                v-model="descInput"
                class="modal-field-control modal-field-textarea"
                :placeholder="t('page.collection_manage.desc_placeholder')"
                @input="syncDescHeight"
              ></textarea>
            </div>
          </div>

          <p class="modal-note">{{ t('page.bookmarks_index.starred_share.enable_modal.note') }}</p>

          <div class="modal-footer-split">
            <button class="modal-btn modal-btn-ghost" type="button" @click="closeModal">{{ t('common.operate.cancel') }}</button>
            <button class="modal-btn modal-btn-primary" type="button" :disabled="isLoading" @click="submit">
              <span v-if="!isLoading">{{ t('page.bookmarks_index.starred_share.enable_modal.submit') }}</span>
              <div v-else class="i-svg-spinners:180-ring-with-bg text-16px" style="color: var(--slax-btn-text)"></div>
            </button>
          </div>
        </template>

        <!-- 成功态：已开启 -->
        <template v-else>
          <button class="modal-close modal-result-close" type="button" aria-label="close" @click="closeModal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <div class="modal-result-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h3 class="modal-result-title">{{ t('page.bookmarks_index.starred_share.enable_modal.success_title') }}</h3>
          <p class="modal-result-desc">{{ t('page.bookmarks_index.starred_share.enable_modal.success_desc') }}</p>
          <button class="modal-btn modal-btn-ghost modal-result-action" type="button" @click="viewCollection">
            {{ t('page.bookmarks_index.starred_share.enable_modal.success_cta') }}
          </button>
        </template>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { RequestError } from '@commons/frontend-utils/request'

import { RESTMethodPath } from '@commons/contracts/const'
import type { UserEnableCollectShare } from '@commons/contracts/interface'
import Toast, { ToastType } from '~/components/Toast'

// current-name 已有名；default-name 兜底
const props = defineProps<{ currentName?: string; defaultName: string }>()
const emits = defineEmits(['dismiss', 'success', 'view'])

const isLoading = ref(false)
const isLocked = useScrollLock(window)
const appear = ref(false)
const step = ref<'form' | 'success'>('form')
// 开启接口直接返回 code，避免竞态
const enabledCode = ref('')
// 优先回填已有名字，否则用默认名
const nameInput = ref(props.currentName?.trim() || props.defaultName)
const descInput = ref('')
const descRef = ref<HTMLTextAreaElement>()

// 描述框随内容自增高
const syncDescHeight = () => {
  const el = descRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

isLocked.value = true

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })
})

const closeModal = () => {
  if (isLoading.value) return
  appear.value = false
}

const onAfterLeave = () => {
  isLocked.value = false
  emits('dismiss')
}

const submit = async () => {
  if (isLoading.value) return
  isLoading.value = true

  let enabled = false
  try {
    const enableRes = await request().post<UserEnableCollectShare>({ url: RESTMethodPath.USER_INFO_ENABLE_SETTING, body: { key: 'share_collect' } })
    if (!enableRes) throw new Error('enable failed')
    enabled = true
    enabledCode.value = enableRes.collection_code ?? ''

    // 两步非事务：命名失败仍已开启，重试幂等
    const name = nameInput.value.trim() || props.defaultName
    const description = descInput.value.trim()
    await request().post({ url: RESTMethodPath.COLLECT_OWNER_SHARE_SETTING, body: { name, description } })

    emits('success') // 通知父组件刷新合集信息
    step.value = 'success'
  } catch (error) {
    // 已开启但命名失败：仍刷新父级状态
    if (enabled) emits('success')
    Toast.showToast({ text: error instanceof RequestError ? error.message : t('common.tips.operate_failed'), type: ToastType.Error })
  } finally {
    isLoading.value = false
  }
}

const viewCollection = () => {
  emits('view', enabledCode.value || undefined)
  appear.value = false
}

const t = (text: string, options: Record<string, string | number> = {}) => {
  return useNuxtApp().$i18n.t(text, options)
}
</script>

<style lang="scss" scoped>
/* ── Overlay ── */
.enable-collection-modal {
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
  width: 600px;
  max-width: calc(100% - 32px);
  max-height: 92vh;
  overflow-y: auto;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-warm),
    0 24px 64px color-mix(in srgb, var(--slax-accent) 16%, transparent),
    inset 0 1px 0 var(--slax-inset-hi);

  &:focus {
    outline: none;
  }
}

.modal-form-dialog {
  padding: 32px;
}

.modal-result-dialog {
  padding: 40px 56px;
  text-align: center;
}

@media (max-width: 640px) {
  .modal-content {
    max-width: calc(100% - 24px);
  }

  .modal-form-dialog {
    padding: 32px 24px;
  }

  .modal-result-dialog {
    padding: 40px 24px;
  }
}

/* ── Header ── */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.modal-title {
  margin: 0;
  font-family: var(--slax-font-serif);
  font-size: 20px;
  font-weight: 500;
  color: var(--slax-text);
  letter-spacing: 0.01em;
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
  transition:
    color var(--slax-dur-fast),
    background var(--slax-dur-fast);

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
  }

  svg {
    width: 16px;
    height: 16px;
  }
}

.modal-desc {
  margin: 0 0 24px;
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-light);
  line-height: 1.65;
}

.modal-note {
  margin: 24px 0 0;
  padding: 8px 16px;
  border-radius: var(--slax-radius-sm);
  background: var(--slax-accent-bg);
  color: var(--slax-text-light);
  font-size: var(--slax-fs-aux);
  line-height: 1.6;
}

/* ── Fields ── */
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.modal-field-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--slax-text-muted);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;

  span {
    color: var(--slax-text-light);
    font-size: var(--slax-fs-aux);
    font-weight: 400;
  }
}

.modal-field-control {
  width: 100%;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: var(--slax-text);
  font-family: inherit;
  outline: none;
  transition:
    border-color var(--slax-dur-fast),
    box-shadow var(--slax-dur-fast),
    background var(--slax-dur-fast);

  &::placeholder {
    color: var(--slax-text-light);
  }

  &:focus {
    border-color: color-mix(in srgb, var(--slax-accent) 40%, var(--slax-border));
    background: var(--slax-surface);
    box-shadow: 0 0 0 4px var(--slax-accent-bg);
  }
}

.modal-field-input {
  height: 48px;
  padding: 0 16px;
  font-size: 16px;
  line-height: 1.5;
}

.modal-field-textarea {
  min-height: 80px;
  padding: 16px;
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  overflow: hidden;
}

/* ── Buttons ── */
.modal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 18px;
  border: 1px solid transparent;
  border-radius: var(--slax-radius-sm);
  font-family: inherit;
  font-size: var(--slax-fs-aux);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--slax-dur-fast);
}

.modal-btn-ghost {
  background: transparent;
  border-color: var(--slax-border);
  color: var(--slax-text-muted);

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
    border-color: color-mix(in srgb, var(--slax-text-light) 40%, var(--slax-border));
  }
}

.modal-btn-primary {
  background: var(--slax-accent);
  border-color: var(--slax-accent);
  color: var(--slax-btn-text);

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

/* ── Footer ── */
.modal-footer-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 24px;

  .modal-btn {
    width: 100%;
    min-height: 48px;
    padding: 8px 16px;
    font-size: 14px;
  }

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
    margin-top: 32px;
  }
}

/* ── Result 成功态 ── */
.modal-result-close {
  position: absolute;
  top: 24px;
  right: 24px;
}

.modal-result-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin: 0 auto 24px;
  border-radius: 50%;
  background: var(--slax-accent-bg);
  color: var(--slax-accent);

  svg {
    width: 24px;
    height: 24px;
  }
}

.modal-result-title {
  margin: 0 0 16px;
  color: var(--slax-text);
  font-size: 20px;
  font-weight: 500;
  line-height: 1.3;
}

.modal-result-desc {
  margin: 0;
  color: var(--slax-text-light);
  font-size: var(--slax-fs-aux);
  line-height: 1.6;
}

.modal-result-action {
  width: 100%;
  min-height: 48px;
  margin-top: 32px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 400;
}

/* ── Transition ── */
.modal-leave-to,
.modal-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

.modal-enter-active,
.modal-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
