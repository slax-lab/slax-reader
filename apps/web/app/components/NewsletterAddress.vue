<template>
  <section class="newsletter-setup" aria-labelledby="newsletter-heading" :aria-busy="loading || pending">
    <h2 id="newsletter-heading">{{ $t('newsletter.title') }}</h2>
    <p>{{ $t('newsletter.description') }}</p>
    <p v-if="loading" role="status">{{ $t('rss.loading') }}</p>
    <template v-else-if="state?.address">
      <div class="address-row">
        <code class="newsletter-address">{{ state.address }}</code>
        <button type="button" data-copy-address @click="copy">
          {{ $t(copied ? 'newsletter.copied' : 'newsletter.copy') }}
        </button>
      </div>
      <p>{{ $t('newsletter.address_stable') }}</p>
    </template>
    <form v-else-if="needsAccount" @submit.prevent="provision">
      <label for="newsletter-account">{{ $t('newsletter.account_label') }}</label>
      <p id="newsletter-account-hint">
        {{ $t('newsletter.account_hint', { domain: state?.domain || '' }) }}
      </p>
      <div class="address-row">
        <input
          id="newsletter-account"
          v-model="account"
          required
          maxlength="64"
          pattern="[A-Za-z0-9._\-]+"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          aria-describedby="newsletter-account-hint"
          :disabled="pending"
        />
        <button type="submit" :disabled="pending || !account.trim()">
          {{ $t(pending ? 'rss.saving' : 'newsletter.create') }}
        </button>
      </div>
    </form>
    <button v-else-if="state?.status === 'not_provisioned'" type="button" data-provision-address :disabled="pending" @click="provision">
      {{ $t(pending ? 'rss.saving' : 'newsletter.create') }}
    </button>
    <p v-else-if="state?.status === 'unavailable'" role="status">
      {{ $t('newsletter.errors.unavailable') }}
    </p>
    <p v-if="setupError" class="newsletter-error" role="alert">
      {{ $t('newsletter.errors.' + setupError) }}
      <button v-if="!state" type="button" @click="load">
        {{ $t('rss.retry') }}
      </button>
    </p>
    <p>{{ $t('newsletter.management_hint') }}</p>
    <p class="newsletter-privacy">{{ $t('newsletter.privacy') }}</p>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'

import type { NewsletterAddressResponse } from '@slax-reader/contracts'
import { useUserStore } from '~/stores/user'

const user = useUserStore()
const state = ref<NewsletterAddressResponse | null>(null)
const account = ref('')
const loading = ref(true),
  pending = ref(false),
  copied = ref(false),
  error = ref('')
const needsAccount = computed(
  () =>
    !state.value?.address &&
    (state.value?.status === 'account_required' ||
      state.value?.status === 'invalid_account' ||
      state.value?.status === 'address_reserved' ||
      ['address_reserved', 'account_taken', 'account_required', 'invalid_account'].includes(error.value))
)
const setupError = computed(() => error.value || (state.value?.status === 'address_reserved' ? 'address_reserved' : ''))
const quiet = () => {}
let generation = 0
const errorCode = (value: unknown) => {
  const failure = value as {
    name?: unknown
    data?: { error?: string }
    message?: string
  }
  if (failure?.name === 'EXISTS_USER_NAME_ERROR') return 'account_taken'
  if (failure?.name === 'ERROR_PARAM') return 'invalid_account'
  const name = failure?.name
  const candidates = [typeof name === 'object' && name ? (name as { error?: string }).error : name, failure?.data?.error, failure?.message]
  return (
    candidates.find(
      (code): code is string => typeof code === 'string' && ['address_reserved', 'account_required', 'invalid_account', 'lab_disabled', 'unavailable'].includes(code)
    ) || 'unavailable'
  )
}
const load = async () => {
  const stamp = ++generation
  state.value = null
  error.value = ''
  copied.value = false
  pending.value = false
  loading.value = true
  try {
    const result = await request().get<NewsletterAddressResponse>({
      url: '/v1/user/newsletter_address',
      errorInterceptors: quiet
    })
    if (stamp === generation)
      state.value = result || {
        address: null,
        domain: null,
        status: 'unavailable'
      }
  } catch (failure) {
    if (stamp === generation) error.value = errorCode(failure)
  } finally {
    if (stamp === generation) loading.value = false
  }
}
const provision = async () => {
  if (pending.value || loading.value || state.value?.address) return
  const stamp = generation
  const setAccount = needsAccount.value
  pending.value = true
  error.value = ''
  try {
    if (setAccount) {
      await request().post({
        url: '/v1/user/setting',
        body: { key: 'account', value: account.value.trim() },
        errorInterceptors: quiet
      })
      if (stamp !== generation) return
      await user.refreshServerUserInfo()
      if (stamp !== generation) return
    }
    await request().post({
      url: '/v1/user/setting/enable',
      body: { key: 'lab:newsletter' },
      errorInterceptors: quiet
    })
    if (stamp !== generation) return
    const result = await request().get<NewsletterAddressResponse>({
      url: '/v1/user/newsletter_address',
      errorInterceptors: quiet
    })
    if (stamp === generation)
      state.value = result || {
        address: null,
        domain: null,
        status: 'unavailable'
      }
  } catch (failure) {
    if (stamp === generation) error.value = errorCode(failure)
  } finally {
    if (stamp === generation) pending.value = false
  }
}
const copy = async () => {
  const address = state.value?.address,
    stamp = generation
  if (!address) return
  try {
    await navigator.clipboard.writeText(address)
    if (stamp === generation) copied.value = true
  } catch {
    if (stamp === generation) error.value = 'copy_failed'
  }
}
watch(
  () => user.userInfo?.userId,
  () => {
    account.value = ''
    void load()
  },
  { flush: 'sync' }
)
onMounted(load)
onScopeDispose(() => {
  generation++
})
</script>
<style scoped>
.newsletter-setup {
  padding: 20px;
  margin: 16px 0 24px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  background: var(--slax-surface);
  color: var(--slax-text);
}
h2 {
  margin: 0 0 8px;
  font-size: var(--slax-fs-card);
  font-weight: 500;
}
p {
  margin: 8px 0;
  color: var(--slax-text-muted);
  font-size: var(--slax-fs-aux);
  line-height: 1.6;
}
label {
  display: block;
  margin-top: 16px;
  font-size: var(--slax-fs-meta);
}
.address-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 12px 0;
}
.newsletter-address {
  overflow-wrap: anywhere;
  font-family: var(--slax-font-mono);
  font-size: var(--slax-fs-meta);
}
input {
  min-width: 0;
  flex: 1 1 180px;
  padding: 10px 12px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-bg);
  color: var(--slax-text);
  font: inherit;
}
button {
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface);
  color: var(--slax-accent);
  font: inherit;
  font-size: var(--slax-fs-aux);
  cursor: pointer;
}
button:hover {
  background: var(--slax-accent-bg);
}
button:disabled,
input:disabled {
  opacity: 0.5;
  cursor: default;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}
p.newsletter-error {
  color: var(--slax-danger);
}
.newsletter-privacy {
  margin-bottom: 0;
}
</style>
