<template>
  <div v-if="visible" class="snapshot-fork-action">
    <button class="fork-button" type="button" :disabled="loading" :aria-busy="loading" :aria-label="$t('common.operate.fork_description')" :title="$t('common.operate.fork_description')" @click="onFork">
      {{ $t(loading ? 'common.operate.forking' : 'common.operate.fork') }}
    </button>
    <p v-if="error" class="fork-error" role="alert">
      {{ $t('common.tips.fork_failed') }}
      <button type="button" class="fork-retry" :disabled="loading" @click="onFork">{{ $t('common.operate.retry') }}</button>
    </p>
  </div>
</template>

<script setup lang="ts">
import { showLoginModal } from '~/components/Modal'
import Toast, { ToastType } from '~/components/Toast'
import { useBookmarkFork } from '~/composables/useBookmarkFork'
import { useUserStore } from '~/stores/user'

const props = defineProps<{ bookmarkUid: string; canFork?: boolean; isOwner?: boolean }>()
const { t } = useI18n()
const redirectHref = useRequestURL().href
const { loading, error, fork } = useBookmarkFork()
const userStore = useUserStore()
const visible = computed(() => !!props.bookmarkUid && props.canFork === true && props.isOwner !== true)

const onFork = async () => {
  if (!visible.value || loading.value) return
  if (!userStore.isLogin) {
    showLoginModal({ redirect: redirectHref })
    return
  }

  try {
    const result = await fork(props.bookmarkUid)
    if (result?.bookmark_uid) {
      Toast.showToast({ text: t('common.tips.fork_success'), type: ToastType.Success })
      await navigateTo(`/b/${encodeURIComponent(result.bookmark_uid)}`)
    }
  } catch {
    // useBookmarkFork exposes the error and keeps the operation key for retry.
  }
}
</script>

<style scoped lang="scss">
.snapshot-fork-action { display: inline-flex; align-items: center; position: relative; }
.fork-button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; min-width: 64px; padding: 0 10px;
  color: var(--slax-text-muted); background: transparent; border: 1px solid transparent;
  border-radius: var(--slax-radius-sm); cursor: pointer; font-size: var(--slax-fs-aux);
}
.fork-button:hover:not(:disabled) { color: var(--slax-accent); background: var(--slax-accent-bg); }
.fork-button:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: 2px; }
.fork-button:disabled { opacity: 0.65; cursor: wait; }
.fork-error {
  position: absolute; right: 0; top: 100%; width: min(220px, calc(100vw - 48px));
  margin: 4px 0 0; padding: 12px; color: var(--slax-danger); background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border); border-radius: var(--slax-radius-sm); font-size: var(--slax-fs-aux);
}
.fork-retry { display: block; min-height: 44px; color: inherit; text-decoration: underline; background: transparent; border: 0; cursor: pointer; }
.fork-retry:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: 2px; }
</style>
