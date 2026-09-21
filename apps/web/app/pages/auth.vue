<template>
  <div class="auth">
    <div class="absolute inset-0 flex items-center justify-center" v-if="loading">
      <div class="i-svg-spinners:180-ring-with-bg text-5xl text-accent"></div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'

const { t } = useI18n()

useHead({
  titleTemplate: `${t('page.auth.authenticating')} - ${t('common.app.name')}`
})

type State = {
  nonce: string
  redirectUrl: string
  target: string
  affCode: string
  platform?: 'apple' | 'google'
}

const route = useRoute()
const auth = useAuth()
const loading = ref(true)

if (import.meta.client) {
  const grantAuth = async () => {
    const code = route.query.code as string
    if (!code) {
      await navigateTo('/login')
      return
    }
    const platform = route.query.platform as string
    if (platform && platform === 'android') {
      await navigateTo('slaxrd://auth?code=' + code, { external: true })
      return
    }
    const state = JSON.parse((route.query.state as string) || '{}') as State
    await auth.grantAuth(code, state.redirectUrl, state.affCode, state.platform || 'google')
    state.target = state.target || '/bookmarks'
    loading.value = false
    await navigateTo(state.target, { external: true })
  }

  grantAuth()
}
</script>

<style lang="scss" scoped>
.auth {
  --style: w-100vw h-100vh;
}
</style>
