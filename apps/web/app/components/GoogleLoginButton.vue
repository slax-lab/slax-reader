<template>
  <button class="google-login-button" data-analytics-element="login_google_button" @click="loginClick">
    <div class="i-logos:google-icon w-20px text-brand" />
    <span>{{ t('component.login_view.google_login') }}</span>
  </button>
</template>

<script lang="ts" setup>
import { isCollectionAuthAttribution, type WebAuthAttribution } from '@slax-reader/contracts/events'
import type { PropType } from 'vue'

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const props = defineProps({
  authAttribution: {
    type: Object as PropType<WebAuthAttribution>,
    required: false
  },
  redirect: {
    type: String,
    require: false,
    default: ''
  },
  affcode: {
    type: String,
    required: false
  }
})

const auth = useAuth()

const loginClick = async () => {
  if (isCollectionAuthAttribution(props.authAttribution)) {
    eventLog({
      event_name: 'element_clicked',
      properties: { screen_name: 'signup', element_id: 'login_google_button', ...props.authAttribution }
    })
  }
  analyticsLog({
    event: 'user_login_start',
    method: 'google'
  })

  await login({
    redirect: props.redirect,
    affcode: props.affcode
  })
}

const login = async (params?: { redirect?: string; affcode?: string }) => {
  await auth.requestAuth({
    redirect: params?.redirect || props.redirect,
    affCode: params?.affcode || (props.affcode as string) || '',
    ...(props.authAttribution ? { authAttribution: props.authAttribution } : {})
  })
}

defineExpose({
  login
})
</script>

<style lang="scss" scoped>
.google-login-button {
  --style: 'w-full h-44px flex-center';
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius-sm);
  cursor: pointer;
  transition: all var(--slax-dur-fast);

  & > * {
    --style: 'not-first:ml-8px';
  }

  span {
    font-size: var(--slax-fs-meta);
    font-weight: 500;
    color: var(--slax-text);
    line-height: 18px;
  }

  &:hover {
    border-color: var(--slax-accent-soft);
    background: var(--slax-accent-bg);
  }

  &:active {
    transform: scale(0.99);
  }
}
</style>
