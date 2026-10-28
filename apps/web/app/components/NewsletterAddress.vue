<template>
  <section class="newsletter-setup" aria-labelledby="newsletter-heading" :aria-busy="loading || pending">
    <header class="setup-header">
      <div class="setup-title">
        <h2 id="newsletter-heading">{{ $t('newsletter.title') }}</h2>
        <span v-if="!loading" class="setup-tag">{{ $t(state?.address ? 'newsletter.fixed' : 'newsletter.not_configured') }}</span>
      </div>
      <button type="button" class="disclosure" data-toggle-newsletter :aria-expanded="!collapsed" aria-controls="newsletter-details" :disabled="pending" @click="toggle">
        {{ $t(collapsed ? 'newsletter.expand' : 'newsletter.collapse') }}
        <svg viewBox="0 0 24 24" aria-hidden="true" :class="{ expanded: !collapsed }">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </header>
    <p v-if="loading" class="setup-description" role="status">
      {{ $t('rss.loading') }}
    </p>
    <div v-else-if="state?.address" class="address-row">
      <div class="address-box">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m4 7 8 6 8-6" /></svg
        ><code class="newsletter-address">{{ state.address }}</code>
      </div>
      <button ref="copyButton" type="button" class="copy-button" data-copy-address @click="copy">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg
        >{{ $t(copied ? 'newsletter.copied' : 'newsletter.copy') }}
      </button>
    </div>
    <div v-else-if="collapsed && state && state.status !== 'unavailable'" class="setup-summary">
      <span>{{ $t('newsletter.setup_summary') }}</span
      ><button type="button" @click="expand">
        {{ $t('newsletter.create') }}
      </button>
    </div>
    <div id="newsletter-details" v-show="!collapsed">
      <template v-if="!loading && state?.address">
        <p class="stable-address">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></svg
          ><span
            ><strong>{{ $t('newsletter.address_permanent') }}</strong> {{ $t('newsletter.address_stable') }}</span
          >
        </p>
        <p class="setup-description">{{ $t('newsletter.description') }}</p>
      </template>
      <form v-else-if="canConfigure" novalidate @submit.prevent="openConfirmation">
        <p class="setup-description">{{ $t('newsletter.description') }}</p>
        <label for="newsletter-account">{{ $t('newsletter.account_label') }}</label>
        <div class="form-row">
          <div class="account-field">
            <input
              id="newsletter-account"
              ref="accountInput"
              v-model="account"
              type="text"
              maxlength="15"
              autocomplete="username"
              autocapitalize="none"
              :spellcheck="false"
              :disabled="pending || !!confirmation"
              :aria-invalid="!!fieldError"
              :aria-describedby="fieldError ? 'newsletter-account-hint newsletter-account-error' : 'newsletter-account-hint'"
              @input="clearFieldError"
            />
            <p id="newsletter-account-hint" class="field-hint">
              {{ $t('newsletter.account_hint') }}
            </p>
            <p v-if="fieldError" id="newsletter-account-error" class="field-error" role="alert">
              {{ $t('newsletter.errors.' + fieldError) }}
            </p>
          </div>
          <button ref="createButton" type="submit" class="primary" :disabled="pending || !candidate || !!fieldError">
            {{ $t('newsletter.create') }}
          </button>
        </div>
        <div v-if="candidate" class="candidate-box">
          <div class="candidate-label">{{ $t('newsletter.candidate') }}</div>
          <code>{{ candidate }}</code>
        </div>
        <p class="stable-address">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></svg
          ><span
            ><strong>{{ $t('newsletter.address_permanent') }}</strong> {{ $t('newsletter.address_stable') }}</span
          >
        </p>
      </form>
      <div v-if="!loading && state && state.status !== 'unavailable'" class="receiving-details">
        <p class="details-title">{{ $t('newsletter.receiving_details') }}</p>
        <p>{{ $t('newsletter.privacy') }}</p>
        <p>{{ $t('newsletter.management_hint') }}</p>
      </div>
    </div>
    <p v-if="globalError" class="setup-error" role="alert">
      {{ $t('newsletter.errors.' + globalError) }}
      <button v-if="!state || state.status === 'unavailable'" type="button" @click="load">
        {{ $t('rss.retry') }}
      </button>
    </p>
    <span class="visually-hidden" role="status">{{ copied ? $t('newsletter.copied') : '' }}</span>
    <dialog
      ref="confirmationDialog"
      class="confirmation-dialog"
      aria-labelledby="newsletter-confirm-title"
      aria-describedby="newsletter-confirm-permanent newsletter-confirm-detail"
      :aria-busy="pending"
      @cancel="onCancel"
      @close="onClose"
      @click="closeBackdrop"
    >
      <h2 id="newsletter-confirm-title">
        {{ $t('newsletter.confirm_title') }}
      </h2>
      <p class="dialog-description">
        {{ $t('newsletter.confirm_description') }}
      </p>
      <div class="confirmed-candidate" data-confirm-candidate>
        {{ confirmation?.address }}
      </div>
      <p id="newsletter-confirm-permanent" class="confirm-permanent">
        {{ $t('newsletter.confirm_permanent') }}
      </p>
      <p id="newsletter-confirm-detail" class="dialog-caption">
        {{ $t('newsletter.confirm_detail') }}
      </p>
      <p v-if="confirmation && confirmation.account.toLowerCase() !== currentAccount.toLowerCase()" class="dialog-caption">
        {{ $t('newsletter.confirm_account', { account: confirmation.account }) }}
      </p>
      <footer class="dialog-actions">
        <button ref="cancelButton" type="button" data-cancel-address :disabled="pending" autofocus @click="closeConfirmation">
          {{ $t('newsletter.confirm_cancel') }}</button
        ><button type="button" class="primary" data-confirm-address :disabled="pending || !confirmation" @click="provision">
          <span v-if="pending" class="pending-spinner" aria-hidden="true" />{{ $t(pending ? 'newsletter.creating' : 'newsletter.confirm_create') }}
        </button>
      </footer>
    </dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'

import { isNewsletterAccount, type NewsletterAddressResponse, type NewsletterEnableSettingRequest } from '@slax-reader/contracts'
import type { UserDetailInfo } from '@slax-reader/contracts/interface'
import { useAccountContext } from '~/composables/useAccountContext'
import { useUserStore } from '~/stores/user'

const user = useUserStore(),
  session = useAccountContext()
const state = ref<NewsletterAddressResponse | null>(null),
  account = ref(''),
  currentAccount = ref(''),
  collapsed = ref(false)
const loading = ref(true),
  pending = ref(false),
  copied = ref(false),
  error = ref('')
const accountInput = ref<HTMLInputElement>(),
  createButton = ref<HTMLButtonElement>(),
  copyButton = ref<HTMLButtonElement>(),
  cancelButton = ref<HTMLButtonElement>(),
  confirmationDialog = ref<HTMLDialogElement>()
let generation = 0,
  disposed = false
const stamp = () => ({
  generation,
  owner: user.userInfo?.userId,
  token: session.snapshot().token
})
type Stamp = ReturnType<typeof stamp>
const current = (s: Stamp) => !disposed && s.generation === generation && s.owner === user.userInfo?.userId && s.token === session.snapshot().token
const confirmation = ref<{
  account: string
  address: string
  stamp: Stamp
  originalAccount: string
} | null>(null)
const fieldCodes = ['account_taken', 'invalid_account', 'address_reserved', 'account_required']
const fieldError = computed(() => (fieldCodes.includes(error.value) ? error.value : ''))
const globalError = computed(() => (!fieldError.value ? error.value || (state.value?.status === 'unavailable' ? 'unavailable' : '') : ''))
const canConfigure = computed(() => !loading.value && !!state.value?.domain && !state.value.address && state.value.status !== 'unavailable')
const candidate = computed(() => {
  if (!state.value?.domain || !isNewsletterAccount(account.value)) return ''
  return 'feed+' + account.value + '@' + state.value.domain
})
const quiet = () => {}
const errorCode = (value: unknown) => {
  const failure = value as {
    name?: unknown
    data?: { error?: string }
    message?: string
  }
  const names = [failure?.name, failure?.data?.error, failure?.message].map(v => (typeof v === 'object' && v ? (v as { error?: string }).error : v))
  if (names.includes('EXISTS_USER_NAME_ERROR')) return 'account_taken'
  if (names.includes('ERROR_PARAM')) return 'invalid_account'
  return names.find((code): code is string => typeof code === 'string' && [...fieldCodes, 'lab_disabled', 'unavailable', 'address_changed'].includes(code)) || 'unavailable'
}
const storageKey = () => (user.userInfo?.userId ? 'slax-newsletter-setup-collapsed:' + user.userInfo.userId : null)
const restoreDisclosure = () => {
  collapsed.value = false
  try {
    const key = storageKey()
    if (import.meta.client && key) collapsed.value = localStorage.getItem(key) === '1'
  } catch {
    /* Local preferences must not block setup. */
  }
}
const toggle = () => {
  collapsed.value = !collapsed.value
  try {
    const key = storageKey()
    if (import.meta.client && key) localStorage.setItem(key, collapsed.value ? '1' : '0')
  } catch {
    /* Keep the in-memory preference when storage is unavailable. */
  }
}
const expand = async () => {
  if (collapsed.value) toggle()
  await nextTick()
  accountInput.value?.focus()
}
const clearFieldError = () => {
  error.value = ''
  copied.value = false
}
const onClose = () => {
  confirmation.value = null
}
const closeConfirmation = () => {
  if (pending.value) return
  confirmationDialog.value?.close()
  confirmation.value = null
  createButton.value?.focus()
}
const onCancel = (event: Event) => {
  if (pending.value) event.preventDefault()
  else confirmation.value = null
}
const closeBackdrop = (event: MouseEvent) => {
  const dialog = confirmationDialog.value
  if (!dialog || event.target !== dialog || pending.value) return
  const r = dialog.getBoundingClientRect()
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeConfirmation()
}
const load = async () => {
  ++generation
  const s = stamp()
  state.value = null
  error.value = ''
  copied.value = false
  pending.value = false
  loading.value = true
  if (!s.owner) {
    loading.value = false
    return
  }
  try {
    const result = await request().get<NewsletterAddressResponse>({
      url: '/v1/user/newsletter_address',
      errorInterceptors: quiet
    })
    if (!current(s)) return
    const nextState = result || { address: null, domain: null, status: 'unavailable' }
    if (!nextState.address && nextState.domain && nextState.status !== 'unavailable') {
      const detail = await request().get<UserDetailInfo>({
        url: '/v1/user/userinfo',
        errorInterceptors: quiet
      })
      if (!current(s)) return
      if (!detail || typeof detail.account !== 'string') throw new Error('Account details unavailable')
      currentAccount.value = detail.account
      if (!account.value) account.value = detail.account
    }
    state.value = nextState
    if (state.value.status === 'address_reserved') {
      error.value = 'address_reserved'
      collapsed.value = false
    }
  } catch (failure) {
    if (current(s)) error.value = errorCode(failure)
  } finally {
    if (current(s)) loading.value = false
  }
}
const openConfirmation = async () => {
  if (pending.value || loading.value || state.value?.address || !user.userInfo?.userId) return
  if (!candidate.value) {
    error.value = 'invalid_account'
    await nextTick()
    accountInput.value?.focus()
    return
  }
  error.value = ''
  confirmation.value = {
    account: account.value,
    address: candidate.value,
    stamp: stamp(),
    originalAccount: currentAccount.value
  }
  confirmationDialog.value?.showModal()
  await nextTick()
  cancelButton.value?.focus()
}
const provision = async () => {
  const selected = confirmation.value
  if (pending.value || !selected) return
  if (!current(selected.stamp) || selected.originalAccount !== currentAccount.value) {
    closeConfirmation()
    account.value = currentAccount.value
    void load()
    return
  }
  pending.value = true
  error.value = ''
  try {
    if (selected.account.toLowerCase() !== String(currentAccount.value).toLowerCase()) {
      await request().post({
        url: '/v1/user/setting',
        body: { key: 'account', value: selected.account },
        errorInterceptors: quiet
      })
      if (!current(selected.stamp)) return
      currentAccount.value = selected.account
    }
    const body: NewsletterEnableSettingRequest = {
      key: 'lab:newsletter',
      newsletter_address: selected.address
    }
    await request().post({
      url: '/v1/user/setting/enable',
      body,
      errorInterceptors: quiet
    })
    if (!current(selected.stamp)) return
    const result = await request().get<NewsletterAddressResponse>({
      url: '/v1/user/newsletter_address',
      errorInterceptors: quiet
    })
    if (!current(selected.stamp)) return
    state.value = result || {
      address: null,
      domain: null,
      status: 'unavailable'
    }
    if (state.value.status === 'address_reserved') error.value = 'address_reserved'
  } catch (failure) {
    if (!current(selected.stamp)) return
    const code = errorCode(failure)
    if (code === 'address_changed') {
      pending.value = false
      closeConfirmation()
      account.value = ''
      await load()
      return
    }
    error.value = code
  } finally {
    if (current(selected.stamp)) {
      pending.value = false
      closeConfirmation()
      await nextTick()
      if (state.value?.address) copyButton.value?.focus()
      else if (fieldError.value) {
        collapsed.value = false
        await nextTick()
        accountInput.value?.focus()
      }
    }
  }
}
const copy = async () => {
  const address = state.value?.address,
    s = stamp()
  if (!address) return
  try {
    await navigator.clipboard.writeText(address)
    if (current(s)) {
      copied.value = true
      error.value = ''
    }
  } catch {
    if (current(s)) error.value = 'copy_failed'
  }
}
const resetOwner = () => {
  ++generation
  pending.value = false
  confirmationDialog.value?.close()
  confirmation.value = null
  account.value = ''
  currentAccount.value = ''
  restoreDisclosure()
  void load()
}
watch([() => user.userInfo?.userId, () => session.context.value.generation], resetOwner, { flush: 'sync' })
onMounted(resetOwner)
onScopeDispose(() => {
  disposed = true
  ++generation
  confirmationDialog.value?.close()
})
</script>

<style scoped>
.newsletter-setup {
  margin: 16px 0 24px;
  padding: 22px 24px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  background: var(--slax-surface);
  color: var(--slax-text);
}
.setup-header,
.setup-title,
.address-row,
.form-row,
.dialog-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.setup-header {
  justify-content: space-between;
  gap: 16px;
}
.setup-title {
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: var(--slax-fs-card);
  font-weight: 600;
  line-height: 1.4;
}
.setup-tag {
  padding: 1px 6px;
  border: 1px solid var(--slax-border);
  border-radius: 5px;
  font-size: var(--slax-fs-tag);
  color: var(--slax-text-muted);
  white-space: nowrap;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 9px 14px;
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  font: inherit;
  font-size: var(--slax-fs-meta);
  line-height: 1.4;
  cursor: pointer;
}
button:hover {
  background: var(--slax-accent-bg);
}
button:disabled,
input:disabled {
  opacity: 0.55;
  cursor: default;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
.primary {
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  border-color: var(--slax-accent);
}
.primary:hover {
  background: var(--slax-accent);
}
svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.65;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.disclosure {
  padding: 6px 10px;
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: var(--slax-text-muted);
  font-size: var(--slax-fs-aux);
}
.disclosure svg {
  width: 14px;
  height: 14px;
}
.disclosure svg.expanded {
  transform: rotate(180deg);
}
.address-row {
  margin-top: 16px;
  gap: 16px;
  min-width: 0;
}
.address-box {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-bg);
}
.address-box svg {
  color: var(--slax-accent);
  width: 17px;
  height: 17px;
}
.newsletter-address {
  font-family: var(--slax-font-mono);
  font-size: var(--slax-fs-meta);
  font-weight: 500;
  line-height: 1.6;
  overflow-wrap: anywhere;
  min-width: 0;
}
.copy-button {
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--slax-accent);
  font-size: var(--slax-fs-aux);
}
.stable-address {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 14px 0 0;
  font-size: var(--slax-fs-aux);
  line-height: 1.6;
}
.stable-address strong {
  font-weight: 600;
}
.stable-address svg {
  width: 15px;
  height: 15px;
  margin-top: 3px;
  color: var(--slax-text-muted);
}
.setup-description {
  margin: 10px 0 18px;
  color: var(--slax-text-muted);
  font-size: var(--slax-fs-meta);
  line-height: 1.6;
}
.receiving-details {
  border-top: 1px solid var(--slax-border);
  margin-top: 20px;
  padding-top: 14px;
  color: var(--slax-text-muted);
  font-size: var(--slax-fs-aux);
  line-height: 1.7;
}
.receiving-details p {
  margin: 0 0 6px;
}
.receiving-details p:last-child {
  margin-bottom: 0;
}
.receiving-details .details-title {
  font-size: var(--slax-fs-tag);
  font-weight: 500;
}
label {
  display: block;
  margin-bottom: 7px;
  font-size: var(--slax-fs-meta);
  font-weight: 500;
}
.form-row {
  align-items: flex-start;
}
.account-field {
  flex: 1;
  min-width: 0;
}
input {
  width: 100%;
  min-width: 0;
  height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-bg);
  color: var(--slax-text);
  font: inherit;
  font-size: var(--slax-fs-meta);
}
input[aria-invalid='true'] {
  border-color: var(--slax-danger);
}
.field-hint,
.field-error {
  margin: 7px 0 0;
  font-size: var(--slax-fs-aux);
  line-height: 1.6;
}
.field-hint {
  color: var(--slax-text-muted);
}
.field-error,
.setup-error {
  color: var(--slax-danger);
}
.setup-error {
  margin: 12px 0 0;
  font-size: var(--slax-fs-aux);
  line-height: 1.6;
}
.candidate-box {
  margin-top: 14px;
  padding: 12px;
  border: 1px dashed var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-bg);
}
.candidate-label {
  margin-bottom: 3px;
  color: var(--slax-text-muted);
  font-size: var(--slax-fs-tag);
}
.candidate-box code {
  font-family: var(--slax-font-mono);
  font-size: var(--slax-fs-aux);
  overflow-wrap: anywhere;
}
.setup-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 12px;
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-muted);
}
.confirmation-dialog {
  margin: auto;
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 28px;
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius);
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  box-shadow: var(--slax-shadow-modal);
}
.confirmation-dialog::backdrop {
  background: color-mix(in srgb, var(--slax-text) 28%, transparent);
}
.confirmation-dialog h2 {
  margin: 0 0 12px;
  font-size: var(--slax-fs-h2);
}
.dialog-description {
  margin: 0 0 16px;
  color: var(--slax-text-muted);
  font-size: var(--slax-fs-meta);
  line-height: 1.6;
}
.confirmed-candidate {
  margin-bottom: 16px;
  padding: 14px;
  background: var(--slax-bg);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  font-family: var(--slax-font-mono);
  font-size: var(--slax-fs-meta);
  overflow-wrap: anywhere;
}
.confirm-permanent {
  margin: 0 0 8px;
  font-size: var(--slax-fs-meta);
  font-weight: 600;
  line-height: 1.6;
}
.dialog-caption {
  margin: 8px 0 0;
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-muted);
  line-height: 1.6;
}
.dialog-actions {
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
.dialog-actions button {
  min-width: 104px;
}
.pending-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: newsletter-spin 0.8s linear infinite;
}
@keyframes newsletter-spin {
  to {
    transform: rotate(360deg);
  }
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
:global([data-slax-theme='eink']) .pending-spinner {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  .pending-spinner {
    animation: none;
  }
}
@media (max-width: 768px) {
  .newsletter-setup {
    padding: 18px;
  }
  .address-row {
    gap: 10px;
  }
  .address-box {
    padding: 10px;
  }
  .address-box > svg {
    display: none;
  }
  .form-row {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .form-row > button {
    width: 100%;
  }
}
@media (max-width: 440px) {
  .newsletter-setup {
    padding: 16px;
  }
  .setup-header {
    gap: 10px;
  }
  .setup-title {
    gap: 6px;
  }
  .setup-title h2 {
    font-size: var(--slax-fs-meta);
  }
  .newsletter-address {
    font-size: var(--slax-fs-aux);
  }
  .copy-button {
    padding-inline: 11px;
  }
  .copy-button svg {
    display: none;
  }
  .confirmation-dialog {
    padding: 22px;
  }
  .dialog-actions {
    flex-wrap: wrap;
  }
  .dialog-actions button {
    flex: 1;
  }
}
</style>
