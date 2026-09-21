<template>
  <button class="google-login-button" data-analytics-element="login_google_button" @click="loginClick">
    <div class="i-logos:google-icon w-20px text-brand" />
    <span>{{ t('component.login_view.google_login') }}</span>
  </button>
</template>

<script lang="ts" setup>
const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const props = defineProps({
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
  await auth.requestAuth({ redirect: params?.redirect || props.redirect, affCode: params?.affcode || (props.affcode as string) || '' })
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
