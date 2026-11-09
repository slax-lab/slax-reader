<template>
  <div class="login-modal" :class="{ appear }" @click="closeModal">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-shell" v-show="appear" @click.stop>
        <button class="modal-close" type="button" :aria-label="t('common.operate.close')" @click="closeModal">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <LoginView ref="loginView" class="modal-login-card" modal :active="appear" :redirect="redirect" :auth-attribution="authAttribution" />
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import LoginView from '~/components/global/LoginView.vue'

import type { CollectionAuthAttribution } from '@slax-reader/contracts/events'
import type { PropType } from 'vue'

const props = defineProps({
  authAttribution: {
    type: Object as PropType<CollectionAuthAttribution>,
    required: false
  },
  redirect: {
    type: String,
    required: true
  }
})

const emits = defineEmits(['close', 'dismiss', 'success'])
const isLocked = useScrollLock(window)
const appear = ref(false)
const loginView = ref<InstanceType<typeof LoginView>>()

watch(appear, visible => {
  if (visible && props.authAttribution) {
    eventLog({ event_name: 'screen_viewed', properties: { screen_name: 'signup', ...props.authAttribution } })
  }
}, { flush: 'post' })

isLocked.value = true

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })
})

const closeModal = () => {
  loginView.value?.cancelEmail()
  appear.value = false
}

const onAfterLeave = () => {
  isLocked.value = false
  emits('dismiss')
}

// bootloader 无全局 $i18n，手动取 t
const t = (text: string) => useNuxtApp().$i18n.t(text)
</script>

<style lang="scss" scoped>
/* ── Overlay ── */
.login-modal {
  --slax-login-inset-top: max(24px, env(safe-area-inset-top));
  --slax-login-inset-bottom: max(24px, env(safe-area-inset-bottom));
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--slax-login-inset-top) max(24px, env(safe-area-inset-right)) var(--slax-login-inset-bottom) max(24px, env(safe-area-inset-left));
  background: transparent;
  transition: background var(--slax-dur-normal) var(--slax-ease-spring);

  &.appear {
    background: color-mix(in srgb, var(--slax-text) 22%, transparent);
    -webkit-backdrop-filter: var(--slax-blur);
    backdrop-filter: var(--slax-blur);
  }
}

/* ── Shell ── */
.modal-shell {
  position: relative;
  width: min(420px, 100%);
}

.modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: none;
  border-radius: var(--slax-radius-sm);
  color: var(--slax-text-muted);
  cursor: pointer;
  transition: background var(--slax-dur-normal) var(--slax-ease-spring), color var(--slax-dur-normal) var(--slax-ease-spring);

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
  }
}

.modal-login-card {
  max-height: calc(100dvh - var(--slax-login-inset-top) - var(--slax-login-inset-bottom));
  overflow-y: auto;
  overscroll-behavior: contain;
  box-shadow: var(--slax-shadow-modal);
}

.modal-close:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 3px;
}

/* ── Entrance and exit ── */
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--slax-dur-normal) var(--slax-ease-spring), transform var(--slax-dur-normal) var(--slax-ease-spring);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
  transform: translateY(-16px);
}

@media (prefers-reduced-motion: reduce) {
  .login-modal,
  .modal-close,
  .modal-enter-active,
  .modal-leave-active {
    transition: none;
  }

  .modal-enter-from,
  .modal-leave-to {
    transform: none;
  }
}
</style>
