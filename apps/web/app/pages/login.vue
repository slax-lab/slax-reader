<template>
  <div class="auth-wrap">
    <div class="auth-stack">
      <LoginView :redirect="redirect" :affcode="affcode" :has-invite="hasInvite">
        <template v-if="hasInvite" #invite>
          <LoginKocBanner :blogger-info="kocBloggerInfo" />
        </template>
      </LoginView>
    </div>
  </div>
</template>

<script lang="ts" setup>
import LoginView from '~/components/global/LoginView.vue'
import LoginKocBanner from '~/components/Login/LoginKocBanner.vue'

import type { BloggerInfo } from '@slax-reader/contracts/interface'
import { RESTMethodPath } from '@slax-reader/contracts/const'

const route = useRoute()
const redirect = `${route.query.redirect || ''}`
const affcode = `${route.query.aff || ''}`
const bloggerParam = `${route.query.blogger || ''}`

const showKocBanner = !!bloggerParam

// /login 是 ssr:false 纯客户端页，
// 用 useAsyncData 会崩，改客户端拉取
const kocBloggerInfo = ref<BloggerInfo | null>(null)

if (import.meta.client && bloggerParam) {
  request()
    .get<BloggerInfo>({
      url: RESTMethodPath.PROMOTION_BLOGGER_INFO,
      query: { blogger: bloggerParam }
    })
    .then(info => {
      kocBloggerInfo.value = info ?? null
    })
    .catch(() => {
      kocBloggerInfo.value = null
    })
}

const hasInvite = computed(() => showKocBanner && !!kocBloggerInfo.value)

const { t } = useI18n()

useHead({
  titleTemplate: `${t('common.operate.login')} - ${t('common.app.name')}`
})

onMounted(() => {
  analyticsLog({ event: 'user_view_login' })
})
</script>

<style lang="scss" scoped>
.auth-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  position: relative;

  // 渐变背景氛围
  &::before {
    content: '';
    position: fixed;
    inset: 0;
    background:
      radial-gradient(at 30% 0%, var(--slax-grad-a) 0%, transparent 50%), radial-gradient(at 80% 20%, var(--slax-grad-b) 0%, transparent 60%),
      radial-gradient(at 50% 80%, var(--slax-grad-c) 0%, transparent 40%);
    z-index: -1;
    pointer-events: none;
  }

  @media (max-width: 540px) {
    padding: 24px 16px;
    align-items: flex-start;
    padding-top: 60px;
  }
}

.auth-stack {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
</style>
