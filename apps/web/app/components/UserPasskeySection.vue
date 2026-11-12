<template>
  <div class="login-method-group passkey-method">
    <div class="login-method-row">
      <span class="login-method-icon"><AppIcon name="empty.lock" :size="24" /></span>
      <div class="login-method-label">
        <span class="login-method-name">{{ t('passkey_auth.title') }}</span>
        <span v-if="!loginEmail" class="login-method-status">{{ t('passkey_auth.mail_required') }}</span>
      </div>
      <button v-if="loginEmail" class="login-method-button passkey-toggle" type="button" :aria-expanded="open" :aria-controls="open ? panelId : undefined" @click="toggle">
        {{ t(open ? 'email_auth.cancel' : 'passkey_auth.manage') }}
      </button>
    </div>
    <div v-if="open" :id="panelId" class="passkey-panel" :aria-busy="Boolean(pending)">
      <p v-if="!supported" class="login-method-status">{{ t('passkey_auth.unsupported') }}</p>
      <p v-if="pending === 'list'" role="status">{{ t('passkey_auth.loading') }}</p>
      <p v-else-if="loaded && !passkeys.length" class="login-method-status">{{ t('passkey_auth.empty') }}</p>
      <ul v-if="passkeys.length" class="passkey-list">
        <li v-for="passkey in passkeys" :key="passkey.uuid" class="passkey-item">
          <div class="login-method-label">
            <span>{{ passkey.name }}</span>
            <span class="login-method-status">{{ t('passkey_auth.created', { date: formatDate(passkey.created_at) }) }}</span>
            <span class="login-method-status">{{ passkey.last_used_at ? t('passkey_auth.last_used', { date: formatDate(passkey.last_used_at) }) : t('passkey_auth.never_used') }}</span>
          </div>
          <button class="login-method-button passkey-delete" type="button" :disabled="Boolean(pending)" :aria-label="`${t('passkey_auth.delete')} ${passkey.name}`" @click="deletePasskey(passkey.uuid)">
            {{ t(pending === passkey.uuid ? 'passkey_auth.deleting' : 'passkey_auth.delete') }}
          </button>
        </li>
      </ul>
      <p v-if="errorKey" class="passkey-error" role="alert">{{ t(errorKey) }}</p>
      <button class="login-method-button passkey-add" type="button" :disabled="Boolean(pending) || !supported || !loaded" @click="addPasskey">
        {{ t(pending === 'add' ? 'passkey_auth.adding' : 'passkey_auth.add') }}
      </button>
      <p class="passkey-announcement" role="status">{{ announcement ? t(announcement) : '' }}</p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import AppIcon from '~/components/AppIcon.vue'

import type { AccountEmailAuthRequest } from '~/utils/accountEmailAuthRequest'
import { passkeyAuthErrorKey } from '~/utils/passkeyAuth'

import { browserSupportsWebAuthn, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { BIND_LOGIN_IDENTITY_SETTING } from '@slax-reader/contracts/email-auth'
import { DELETE_PASSKEY_SETTING, type PasskeyInfo, type PasskeyRegistrationChallenge } from '@slax-reader/contracts/passkey'

const props = defineProps<{ account: AccountEmailAuthRequest; loginEmail?: string }>()
const { t, locale } = useI18n()
const panelId = useId()
const open = ref(false)
const supported = ref(false)
const loaded = ref(false)
const passkeys = ref<PasskeyInfo[]>([])
const pending = ref('')
const errorKey = ref('')
const announcement = ref('')
let operation: AbortController | undefined

onMounted(() => { supported.value = browserSupportsWebAuthn() })
const stop = () => {
  operation?.abort()
  operation = undefined
  pending.value = ''
}
onBeforeUnmount(stop)
const formatDate = (date: string) => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(date))

const loadPasskeys = async (signal: AbortSignal) => {
  const response = await props.account.api.get<PasskeyInfo[]>({ url: RESTMethodPath.USER_PASSKEY_LIST, signal, errorInterceptors: () => {} })
  signal.throwIfAborted()
  if (!response) throw new Error('Passkey list failed')
  passkeys.value = response
  loaded.value = true
}

const perform = async (kind: string, action: (signal: AbortSignal) => Promise<void>) => {
  if (pending.value) return
  const controller = new AbortController()
  operation = controller
  pending.value = kind
  errorKey.value = ''
  announcement.value = ''
  try {
    await action(controller.signal)
  } catch (error) {
    if (!controller.signal.aborted) errorKey.value = passkeyAuthErrorKey(error)
  } finally {
    if (operation === controller) {
      operation = undefined
      pending.value = ''
    }
  }
}

const toggle = async () => {
  if (open.value) {
    stop()
    open.value = false
    return
  }
  open.value = true
  loaded.value = false
  passkeys.value = []
  await perform('list', loadPasskeys)
}

const addPasskey = () => perform('add', async signal => {
  if (!props.loginEmail) return
  const response = await props.account.api.post<PasskeyRegistrationChallenge>({
    url: RESTMethodPath.PASSKEY_CHALLENGE, body: { purpose: 'register' }, signal, errorInterceptors: () => {}
  })
  signal.throwIfAborted()
  if (!response || response.purpose !== 'register') throw new Error('Passkey challenge failed')
  const cancelCeremony = () => WebAuthnAbortService.cancelCeremony()
  signal.addEventListener('abort', cancelCeremony, { once: true })
  try {
    const credential = await startRegistration({ optionsJSON: response.options })
    signal.throwIfAborted()
    props.account.assertCurrentAccount()
    const result = await props.account.api.post<{ linked: true }>({
      url: RESTMethodPath.USER_INFO_SETTING,
      body: { key: BIND_LOGIN_IDENTITY_SETTING, value: { type: 'passkey', request_id: response.request_id, credential, name: 'Passkey' } },
      signal, errorInterceptors: () => {}
    })
    signal.throwIfAborted()
    if (!result?.linked) throw new Error('Passkey registration failed')
    await loadPasskeys(signal)
    announcement.value = 'passkey_auth.added'
  } finally {
    signal.removeEventListener('abort', cancelCeremony)
  }
})

const deletePasskey = (uuid: string) => perform(uuid, async signal => {
  const result = await props.account.api.post<{ deleted: true }>({
    url: RESTMethodPath.USER_INFO_SETTING,
    body: { key: DELETE_PASSKEY_SETTING, value: { uuid } }, signal, errorInterceptors: () => {}
  })
  signal.throwIfAborted()
  if (!result?.deleted) throw new Error('Passkey deletion failed')
  passkeys.value = passkeys.value.filter(passkey => passkey.uuid !== uuid)
  announcement.value = 'passkey_auth.deleted'
})
</script>

<style scoped>
.passkey-method { padding: 12px 0; border-top: 1px solid var(--slax-border); }
.login-method-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 8px 12px; min-height: 44px; }
.login-method-icon { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; }
.login-method-label { display: grid; min-width: 0; gap: 2px; overflow-wrap: anywhere; }
.login-method-name { font-weight: 500; }
.login-method-status { color: var(--slax-text-muted); font-size: var(--slax-fs-aux); font-weight: 400; }
.login-method-button { min-height: 44px; max-width: 100%; padding: 8px 12px; border: 1px solid var(--slax-border-strong); border-radius: var(--slax-radius-sm); background: var(--slax-surface-solid); color: var(--slax-text); font: inherit; font-weight: 500; cursor: pointer; }
.login-method-button:hover:not(:disabled) { background: var(--slax-accent-bg); border-color: var(--slax-accent-soft); }
.login-method-button:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: 2px; }
.login-method-button:disabled { cursor: default; opacity: 0.65; }
.passkey-panel { display: grid; gap: 10px; margin: 12px 0 0 44px; }
.passkey-panel p { margin: 0; }
.passkey-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.passkey-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
.passkey-delete { color: var(--slax-danger); }
.passkey-add { justify-self: start; }
.passkey-error { border-inline-start: 2px solid var(--slax-danger); background: var(--slax-danger-bg); padding: 8px 10px; }
.passkey-announcement { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; }
@media (max-width: 540px) {
  .login-method-row { grid-template-columns: 24px minmax(0, 1fr) auto; column-gap: 10px; }
  .login-method-icon { width: 24px; }
  .login-method-button { padding-inline: 10px; font-size: var(--slax-fs-aux); }
  .passkey-panel { margin-inline-start: 34px; }
}
@media (max-width: 359px) { .passkey-panel { margin-inline-start: 0; } }
</style>
