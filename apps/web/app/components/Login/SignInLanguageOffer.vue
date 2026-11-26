<template>
  <aside v-if="visible && choice" class="language-offer" :lang="choice.origin" aria-labelledby="sign-in-language-question">
    <div class="heading">
      <p id="sign-in-language-question">{{ label('question') }}</p>
      <button type="button" class="dismiss" :aria-label="t('common.operate.close', {}, { locale: choice.origin })" :disabled="saving" @click="dismiss">×</button>
    </div>
    <div class="actions">
      <button type="button" :disabled="saving" @click="apply">{{ label('use_origin') }}</button>
      <button type="button" :disabled="saving" @click="dismiss">{{ label('keep') }}</button>
    </div>
    <p v-if="failed" role="alert">{{ label('failed') }}</p>
  </aside>
</template>

<script lang="ts" setup>
import type { SignInLanguageChoice } from '~/utils/signInLanguage'
import { localeAccountIdentity } from '~/utils/userLocaleTasks'

import { useUserStore } from '~/stores/user'

const store = useUserStore()
const choice = useState<SignInLanguageChoice | undefined>('sign-in-language-choice')
const { t, loadLocaleMessages } = useI18n()
const saving = ref(false)
const failed = ref(false)
const loaded = ref('')
const visible = computed(() => choice.value && loaded.value === choice.value.origin && store.confirmedAccountLocale?.accountKey === choice.value.accountKey && store.confirmedAccountLocale.locale !== choice.value.origin)
watch(choice, async entry => {
  failed.value = false
  if (!entry) return
  await loadLocaleMessages(entry.origin)
  if (choice.value === entry) loaded.value = entry.origin
}, { immediate: true })
const label = (key: string) => t('sign_in_language.' + key, {}, { locale: choice.value!.origin })
const dismiss = () => { choice.value = undefined }
const apply = async () => {
  const entry = choice.value
  if (!entry || localeAccountIdentity(getUserToken()) !== entry.accountKey) return dismiss()
  saving.value = true
  try {
    await store.changeLocale(entry.origin)
    dismiss()
  } catch {
    failed.value = true
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.language-offer {
  position: fixed;
  z-index: 1000;
  inset-inline-end: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  max-width: calc(100vw - 32px);
  padding: 16px;
  color: var(--slax-text);
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius);
  font: var(--slax-fs-body) var(--slax-font-sans);
}
.language-offer p { margin: 0; }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dismiss { min-width: 44px; min-height: 44px; margin: -10px -10px -10px 0; color: var(--slax-text-muted); background: transparent; border: 0; cursor: pointer; font: inherit; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.actions button {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  color: var(--slax-text);
  background: var(--slax-surface-solid);
  font: inherit;
  cursor: pointer;
}
.language-offer button:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: 2px; }
</style>
