<template>
  <div class="collection-manage">
    <NuxtLoadingIndicator color="var(--slax-accent)" />

    <!-- 顶栏：固定 56px，毛玻璃 -->
    <header class="cm-topbar">
      <div class="cm-topbar-inner">
        <div class="cm-topbar-left">
          <button class="cm-logo" @click="navigateTo('/bookmarks')">
            <img src="@images/icon-logo-bookmark.png" width="24" height="24" alt="" />
            <span class="cm-logo-text">{{ $t('common.app.name') }}</span>
          </button>
          <ClientOnly><ThemeSwitcher /></ClientOnly>
        </div>
      </div>
    </header>

    <main class="cm-shell">
      <Transition name="opacity" mode="out-in">
        <div v-if="loading" key="loading" class="cm-loading">
          <div class="i-svg-spinners:90-ring w-2em" style="color: var(--slax-accent)"></div>
        </div>

        <div v-else key="content">
          <!-- 页头 -->
          <section class="cm-header">
            <NuxtLink class="cm-back-link" :to="backLink.to">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 12H5" />
                <path d="M11 18l-6-6 6-6" />
              </svg>
              <span>{{ backLink.label }}</span>
            </NuxtLink>
            <div class="cm-title-row">
              <h1 class="cm-title">{{ $t('page.collection_manage.title') }}</h1>
              <div class="cm-status-pill" :class="{ 'is-off': !isOpen }" aria-live="polite">
                <span class="cm-status-dot" aria-hidden="true"></span>
                <span>{{ isOpen ? $t('page.collection_manage.status_open') : $t('page.collection_manage.status_closed') }}</span>
              </div>
            </div>
            <!-- CLOSED 通知条 -->
            <div v-if="!isOpen" class="cm-closed-notice">
              <span class="cm-closed-text">{{ $t('page.collection_manage.closed_notice') }}</span>
              <button class="cm-reopen-btn" type="button" :disabled="statusLoading" @click="reopenCollection">
                {{ $t('page.collection_manage.reopen') }}
              </button>
            </div>
            <p v-if="isOpen" class="cm-page-desc">{{ $t('page.collection_manage.page_desc') }}</p>
          </section>

          <!-- 表单 + 概况 -->
          <section class="cm-layout">
            <form class="cm-form-panel" @submit.prevent="saveSettings">
              <!-- 合集链接（只读 + 复制） -->
              <div class="cm-link-panel">
                <div class="cm-link-label">
                  {{ $t('page.collection_manage.link_label') }}
                  <span class="cm-link-hint">{{ isOpen ? $t('page.collection_manage.link_hint') : $t('page.collection_manage.link_hint_closed') }}</span>
                </div>
                <div class="cm-link-row">
                  <div class="cm-link-value" :class="{ 'is-disabled': !isOpen }" :aria-disabled="!isOpen ? 'true' : 'false'">
                    <span class="cm-link-value-text">{{ collectionUrl }}</span>
                  </div>
                  <button class="cm-link-copy" type="button" :disabled="!isOpen" @click="copyLink">
                    {{ copied ? $t('page.collection_manage.copied') : $t('page.collection_manage.copy') }}
                  </button>
                </div>
              </div>

              <!-- 名称 -->
              <div class="cm-field">
                <label class="cm-field-label" for="cm-name">
                  {{ $t('page.collection_manage.name_label') }}
                </label>
                <input
                  id="cm-name"
                  v-model="nameInput"
                  class="cm-field-control cm-field-input"
                  type="text"
                  autocomplete="off"
                  :disabled="!isOpen"
                  :placeholder="$t('page.collection_manage.name_placeholder')"
                />
              </div>

              <!-- 描述 -->
              <div class="cm-field">
                <label class="cm-field-label" for="cm-desc">
                  {{ $t('page.collection_manage.desc_label') }}
                  <span>{{ $t('page.collection_manage.optional') }}</span>
                </label>
                <textarea
                  id="cm-desc"
                  ref="descRef"
                  v-model="descInput"
                  class="cm-field-control cm-field-textarea"
                  :disabled="!isOpen"
                  :placeholder="$t('page.collection_manage.desc_placeholder')"
                  @input="syncDescHeight"
                ></textarea>
              </div>

              <!-- 保存（仅 OPEN） -->
              <div v-if="isOpen" class="cm-form-actions">
                <button class="cm-primary-btn" type="submit" :class="{ disabled: saveLoading }">
                  <div v-if="saveLoading" class="i-svg-spinners:180-ring-with-bg text-18px" style="color: var(--slax-btn-text)"></div>
                  <span v-else>{{ $t('page.collection_manage.save') }}</span>
                </button>
              </div>

              <!-- 危险操作（仅 OPEN） -->
              <div v-if="isOpen" class="cm-danger-row">
                <h2 class="cm-danger-title">{{ $t('page.collection_manage.danger_title') }}</h2>
                <p class="cm-danger-desc">
                  {{ $t('page.collection_manage.danger_desc') }}
                  <span class="cm-danger-divider" aria-hidden="true"></span>
                  <button class="cm-danger-text-btn" type="button" @click="openCloseModal">{{ $t('page.collection_manage.close_collection') }}</button>
                </p>
              </div>
            </form>

            <!-- 概况侧栏 -->
            <aside class="cm-side-panel" :aria-label="$t('page.collection_manage.title')">
              <div class="cm-side-block">
                <div class="cm-side-label">{{ $t('page.collection_manage.overview_articles') }}</div>
                <div class="cm-side-value">{{ articleCount }}</div>
                <p class="cm-side-copy">{{ $t('page.collection_manage.overview_articles_hint') }}</p>
              </div>
              <div class="cm-side-block">
                <div class="cm-side-label">{{ $t('page.collection_manage.overview_subscribers') }}</div>
                <div class="cm-side-value">{{ subscriberCount }}</div>
                <p class="cm-side-copy">{{ $t('page.collection_manage.overview_subscribers_hint') }}</p>
              </div>
            </aside>
          </section>
        </div>
      </Transition>
    </main>

    <!-- 关闭确认弹窗 -->
    <ClientOnly>
      <Teleport to="body">
        <div class="cm-modal-backdrop" :class="{ open: closeModalOpen }" @click="closeCloseModal"></div>
        <div
          v-show="closeModalOpen"
          ref="closeModalRef"
          class="cm-modal"
          :class="{ open: closeModalOpen }"
          role="dialog"
          aria-modal="true"
          :aria-label="$t('page.collection_manage.confirm_title')"
          tabindex="-1"
        >
          <h3 class="cm-modal-title">{{ $t('page.collection_manage.confirm_title') }}</h3>
          <p class="cm-modal-desc">{{ $t('page.collection_manage.confirm_desc') }}</p>
          <div class="cm-modal-footer">
            <button class="cm-modal-btn cm-modal-btn-ghost" type="button" @click="closeCloseModal">{{ $t('page.collection_manage.confirm_cancel') }}</button>
            <button class="cm-modal-btn cm-modal-btn-danger" type="button" :disabled="statusLoading" @click="confirmClose">{{ $t('page.collection_manage.confirm_close') }}</button>
          </div>
        </div>
      </Teleport>
    </ClientOnly>
  </div>
</template>

<script lang="ts" setup>
import ThemeSwitcher from '~/components/global/ThemeSwitcher.vue'

import { copyText } from '@commons/frontend-utils/string'

import { RESTMethodPath } from '@commons/contracts/const'
import type { UserEnableCollectShare, UserShareCollectInfo } from '@commons/contracts/interface'
import Toast, { ToastType } from '~/components/Toast'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const route = useRoute()

// 默认合集名：「xx 的阅读推荐」
const defaultCollectionName = computed(() => t('page.collection_manage.default_name', { name: useUserStore().userInfo?.name ?? '' }))
const $config = useNuxtApp().$config.public

const loading = ref(true)
const saveLoading = ref(false)
const statusLoading = ref(false)
const copied = ref(false)

const collectInfo = ref<UserShareCollectInfo | null>(null)
const nameInput = ref('')
const descInput = ref('')
const descRef = ref<HTMLTextAreaElement>()

// status 1=OPEN 0=CLOSED
const isOpen = computed(() => collectInfo.value?.status === 1)

const collectionUrl = computed(() => {
  const base = $config.SHARE_BASE_URL || ''
  return `${base}/c/${collectInfo.value?.collection_code ?? ''}`
})

const articleCount = computed(() => collectInfo.value?.starred_count ?? 0)
const subscriberCount = computed(() => collectInfo.value?.subscriber_count ?? 0)

// 返回链接按 ?from 区分
const backLink = computed(() => {
  if (route.query.from === 'starred') {
    return { label: t('page.collection_manage.back_to_starred'), to: '/bookmarks?filter=starred' }
  }
  return { label: t('page.collection_manage.back_to_collection'), to: `/c/${collectInfo.value?.collection_code ?? ''}` }
})

const applyModel = (info: UserShareCollectInfo) => {
  collectInfo.value = info
  nameInput.value = info.show_name || ''
  descInput.value = info.description || ''
  nextTick(syncDescHeight)
}

const loadInfo = async () => {
  try {
    const info = await request().get<UserShareCollectInfo>({ url: RESTMethodPath.COLLECT_MINE })
    // 无 code→未开启，回引导
    if (!info?.collection_code) {
      navigateTo('/bookmarks', { replace: true })
      return
    }
    applyModel(info)
  } catch {
    navigateTo('/bookmarks', { replace: true })
    return
  } finally {
    loading.value = false
  }
}

const syncDescHeight = () => {
  const el = descRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

const copyLink = async () => {
  if (!isOpen.value) return
  try {
    await copyText(collectionUrl.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
    Toast.showToast({ text: t('page.collection_manage.toast_copied') })
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
}

const saveSettings = async () => {
  if (!isOpen.value || saveLoading.value) return
  saveLoading.value = true
  // 名称选填，留空回退默认名
  const name = nameInput.value.trim() || defaultCollectionName.value
  const description = descInput.value.trim()
  try {
    const res = await request().post({
      url: RESTMethodPath.COLLECT_OWNER_SHARE_SETTING,
      body: { name, description }
    })
    if (!res) throw new Error('save failed')
    nameInput.value = name
    if (collectInfo.value) collectInfo.value = { ...collectInfo.value, show_name: name, description }
    Toast.showToast({ text: t('page.collection_manage.toast_saved') })
  } catch {
    Toast.showToast({ text: t('common.tips.save_failed'), type: ToastType.Error })
  } finally {
    saveLoading.value = false
  }
}

const setEnabled = async (enable: boolean) => {
  if (statusLoading.value) return
  statusLoading.value = true
  try {
    const url = enable ? RESTMethodPath.USER_INFO_ENABLE_SETTING : RESTMethodPath.USER_INFO_DISABLE_SETTING
    const res = await request().post<UserEnableCollectShare>({ url, body: { key: 'share_collect' } })
    if (!res) throw new Error('toggle failed')
    if (collectInfo.value) collectInfo.value = { ...collectInfo.value, ...res }
    Toast.showToast({ text: enable ? t('page.collection_manage.toast_reopened') : t('page.collection_manage.toast_closed') })
    return true
  } catch {
    Toast.showToast({ text: t('common.tips.save_failed'), type: ToastType.Error })
    return false
  } finally {
    statusLoading.value = false
  }
}

const reopenCollection = () => setEnabled(true)

// ── 关闭确认弹窗 ──
const closeModalOpen = ref(false)
const closeModalRef = ref<HTMLDivElement>()

const openCloseModal = () => {
  closeModalOpen.value = true
  document.body.classList.add('modal-open')
  nextTick(() => closeModalRef.value?.focus({ preventScroll: true }))
}

const closeCloseModal = () => {
  closeModalOpen.value = false
  document.body.classList.remove('modal-open')
}

const confirmClose = async () => {
  const ok = await setEnabled(false)
  if (ok) closeCloseModal()
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && closeModalOpen.value) closeCloseModal()
}

useHead({ title: `${t('page.collection_manage.title')} - ${t('common.app.name')}` })

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  loadInfo()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.classList.remove('modal-open')
})
</script>

<style lang="scss" scoped>
.collection-manage {
  --style: w-full relative;
  min-height: 100vh;
}

.cm-topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: var(--slax-topbar-bg);
  backdrop-filter: var(--slax-blur);
  border-bottom: 1px solid var(--slax-border);
  z-index: 100;
}

.cm-topbar-inner {
  max-width: 920px;
  margin: 0 auto;
  padding: 0 24px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 24px;

  @media (max-width: 760px) {
    padding: 0 16px;
  }
}

// logo + 主题切换成组
.cm-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cm-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-brand);
  font-weight: 500;

  img {
    display: block;
    flex-shrink: 0;
  }

  @media (max-width: 520px) {
    .cm-logo-text {
      display: none;
    }
  }
}

.cm-shell {
  max-width: 920px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 56px 24px 88px;

  @media (max-width: 760px) {
    padding: 56px 16px 80px;
  }
}

.cm-loading {
  --style: flex-center;
  min-height: 60vh;
}

// ── 页头 ──
.cm-header {
  padding: 48px 4px 40px;
  border-bottom: 1px solid var(--slax-border);

  @media (max-width: 760px) {
    padding: 48px 0 32px;
  }
}

.cm-back-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 32px;
  color: var(--slax-text-light);
  font-size: 14px;
  line-height: 1;
  text-decoration: none;
  transition: color var(--slax-dur-fast) ease;

  &:hover {
    color: var(--slax-accent);
  }

  svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
}

.cm-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;

  @media (max-width: 520px) {
    align-items: flex-start;
    flex-direction: column;
  }
}

.cm-title {
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  font-size: 24px;
  font-weight: 500;
  line-height: 1.3;
}

.cm-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--slax-accent-bg);
  color: var(--slax-accent);
  font-size: 12px;
  white-space: nowrap;

  &.is-off {
    border: 1px solid var(--slax-border);
    background: var(--slax-surface);
    color: var(--slax-text-light);
  }

  .cm-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: currentColor;
  }
}

.cm-closed-notice {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 16px;

  @media (max-width: 520px) {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}

.cm-closed-text {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  min-height: 40px;
  padding: 0 16px;
  border-radius: var(--slax-radius-sm);
  background: var(--slax-danger-bg);
  color: var(--slax-accent);
  font-size: 13px;
  line-height: 1.4;
}

.cm-reopen-btn {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--slax-accent);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  transition: all var(--slax-dur-fast) ease;

  &:hover:not(:disabled) {
    opacity: 0.92;
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.cm-page-desc {
  max-width: 640px;
  margin-top: 16px;
  color: var(--slax-text-muted);
  font-size: 14px;
  font-weight: 300;
  line-height: 1.8;
}

// ── 表单 + 概况 ──
.cm-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 60px;
  padding: 40px 4px 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    gap: 40px;
    padding: 32px 0 0;
  }
}

.cm-form-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.cm-link-panel {
  width: 100%;
  display: grid;
  gap: 10px;
}

.cm-link-label {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--slax-text-muted);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
}

.cm-link-hint {
  color: var(--slax-text-light);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.4;
}

.cm-link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
  }
}

.cm-link-value {
  min-height: 40px;
  display: flex;
  align-items: center;
  max-width: 100%;
  padding: 0 16px;
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface);
  overflow: hidden;
  color: var(--slax-text-light);
  cursor: default;
  font-size: 14px;
  line-height: 1.5;
  white-space: nowrap;

  &.is-disabled {
    user-select: none;
  }

  .cm-link-value-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.cm-link-copy {
  min-width: 80px;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: var(--slax-text-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  transition: all var(--slax-dur-fast) ease;

  &:hover:not(:disabled) {
    background: var(--slax-accent-bg);
    border-color: var(--slax-accent-soft);
    color: var(--slax-accent);
  }

  &:disabled {
    color: var(--slax-text-light);
    cursor: not-allowed;
    opacity: 0.65;
  }

  @media (max-width: 520px) {
    justify-self: start;
  }
}

.cm-field {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cm-field-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--slax-text-muted);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;

  span {
    color: var(--slax-text-light);
    font-size: 13px;
    font-weight: 400;
  }
}

.cm-field-control {
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

  &:focus {
    border-color: var(--slax-accent-soft);
    background: var(--slax-surface);
    box-shadow: 0 0 0 4px var(--slax-accent-bg);
  }

  &:disabled {
    background: var(--slax-surface);
    color: var(--slax-text-muted);
    cursor: not-allowed;
    opacity: 0.75;
  }

  &::placeholder {
    color: var(--slax-text-light);
  }
}

.cm-field-input {
  height: 48px;
  padding: 0 16px;
  font-size: 16px;
  line-height: 1.5;
}

.cm-field-textarea {
  min-height: 80px;
  padding: 16px;
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  overflow: hidden;
}

.cm-form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;

  @media (max-width: 760px) {
    display: grid;
    grid-template-columns: 1fr;
  }
}

.cm-primary-btn {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 24px;
  border: 1px solid var(--slax-accent);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  transition: all var(--slax-dur-fast) ease;

  &:hover:not(.disabled) {
    opacity: 0.92;
    transform: translateY(-1px);
  }

  &.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.cm-danger-row {
  margin-top: 24px;
  padding: 16px 0;
  border-top: 1px solid var(--slax-border);
  border-bottom: 1px solid var(--slax-border);
}

.cm-danger-title {
  color: var(--slax-danger);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
}

.cm-danger-desc {
  margin-top: 8px;
  color: var(--slax-text-light);
  font-size: 13px;
  line-height: 1.6;
}

.cm-danger-divider {
  display: inline-block;
  width: 1px;
  height: 12px;
  margin: 0 8px;
  background: var(--slax-border);
  vertical-align: -1px;
}

.cm-danger-text-btn {
  border: none;
  background: transparent;
  color: var(--slax-danger);
  cursor: pointer;
  font: inherit;
  line-height: inherit;
  padding: 0;

  &:hover {
    opacity: 0.85;
  }
}

// ── 概况侧栏 ──
.cm-side-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;

  @media (max-width: 760px) {
    order: -1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
  }
}

.cm-side-block {
  padding-bottom: 24px;
  border-bottom: 1px solid var(--slax-border);

  @media (max-width: 760px) {
    padding-bottom: 16px;
  }
}

.cm-side-label {
  color: var(--slax-text-light);
  font-size: 12px;
  line-height: 1;
}

.cm-side-value {
  margin-top: 8px;
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  font-size: 22px;
  font-weight: 500;
  line-height: 1;
}

.cm-side-copy {
  margin-top: 8px;
  color: var(--slax-text-muted);
  font-size: 13px;
  line-height: 1.7;
}

// ── 关闭确认弹窗 ──
.cm-modal-backdrop {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--slax-text) 22%, transparent);
  backdrop-filter: blur(8px);
  z-index: 999;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;

  &.open {
    opacity: 1;
    pointer-events: auto;
  }
}

.cm-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  width: 600px;
  max-width: calc(100% - 32px);
  padding: 40px 56px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  background: var(--slax-surface-solid);
  box-shadow: var(--slax-shadow-warm);
  z-index: 1000;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, calc(-50% + 8px)) scale(0.96);
  transition:
    opacity 0.22s ease,
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);

  &.open {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, -50%) scale(1);
  }

  &:focus {
    outline: none;
  }

  @media (max-width: 760px) {
    padding: 32px 24px;
  }
}

.cm-modal-title {
  margin: 0;
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  font-size: 20px;
  font-weight: 500;
  line-height: 1.3;
}

.cm-modal-desc {
  margin: 24px 0 0;
  color: var(--slax-text-muted);
  font-size: 14px;
  line-height: 1.8;
}

.cm-modal-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 40px;

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
  }
}

.cm-modal-btn {
  width: 100%;
  min-height: 48px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: var(--slax-radius-sm);
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  transition: all var(--slax-dur-fast);

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.cm-modal-btn-ghost {
  border-color: var(--slax-border);
  color: var(--slax-text-muted);

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
  }
}

.cm-modal-btn-danger {
  border-color: var(--slax-danger);
  color: var(--slax-danger);

  &:hover:not(:disabled) {
    background: var(--slax-danger-bg);
  }
}
</style>
