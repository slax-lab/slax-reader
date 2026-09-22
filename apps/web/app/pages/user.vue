<template>
  <div class="user-info">
    <NuxtLoadingIndicator color="var(--slax-accent)" />

    <!-- Same top bar as the inbox, so the header does not change shape between pages -->
    <BookmarksTopBar :sidebar-toggle="false" @search="searchBookmarks" @feedback="feedbackClick" />

    <div class="content">
      <nav v-if="!loading" class="settings-nav" :aria-label="$t('page.user.navigation.title')">
        <h1>{{ $t('page.user.navigation.title') }}</h1>
        <div class="settings-nav-links">
          <a
            v-for="section in sections"
            :key="section"
            :href="`#${section}`"
            :aria-current="activeSection === section ? 'location' : undefined"
            @click.prevent="goToSection(section)"
          >
            {{ $t(`page.user.navigation.${section}`) }}
          </a>
        </div>
      </nav>
      <Transition name="opacity" mode="out-in">
        <main ref="detail" class="detail" v-if="!loading" key="content">
          <section id="account" class="settings-group" aria-labelledby="account-heading" v-if="userInfo">
            <h2 id="account-heading" class="group-title">{{ $t('page.user.navigation.account') }}</h2>
            <div class="settings-card">
              <div class="personal">
                <img class="avatar" :src="userInfo.avatar || avatarUrl" alt="" />
                <div class="personal-text">
                  <span class="username">{{ userInfo.name }}</span>
                  <span class="email">{{ userInfo.email }}</span>
                </div>
              </div>
            </div>
            <UserRelatedInfoSection section="account" :user-info="userInfo" @update="getUserDetailInfo" />
          </section>

          <section id="preferences" class="settings-group" aria-labelledby="preferences-heading">
            <h2 id="preferences-heading" class="group-title">{{ $t('page.user.navigation.preferences') }}</h2>
            <div class="settings-card">
              <div class="settings-row">
                <span class="settings-label">{{ $t('page.user.language') }}</span>
                <OptionsBar :options="languageOptions.map(option => option.name)" :defaultSelectedIndex="languageOptionIndex" @option-selected="localeSelect" />
              </div>
              <div class="settings-divider" v-if="userInfo" />
              <div class="settings-row" v-if="userInfo">
                <div class="settings-label-group">
                  <AILanguageTips />
                  <span class="settings-label">{{ $t('page.user.ai_response_language') }}</span>
                </div>
                <OptionsBar :options="aiLanguageOptions.map(option => option.name)" :defaultSelectedIndex="aiLanguageOptionIndex" @option-selected="aiResponseLanguageSelect" />
              </div>
            </div>
          </section>

          <section id="connections" class="settings-group" aria-labelledby="connections-heading" v-if="userInfo">
            <h2 id="connections-heading" class="group-title">{{ $t('page.user.navigation.connections') }}</h2>
            <UserRelatedInfoSection section="connections" :user-info="userInfo" @update="getUserDetailInfo" />
          </section>

          <section id="features" class="settings-group" aria-labelledby="features-heading" v-show="hasLabs">
            <h2 id="features-heading" class="group-title">{{ $t('page.user.navigation.features') }}</h2>
            <UserLabSection />
          </section>

          <section id="data" class="settings-group" aria-labelledby="data-heading">
            <h2 id="data-heading" class="group-title">{{ $t('page.user.navigation.data') }}</h2>
            <UserImportSection />
            <UserExportSection />
          </section>

          <section id="support" class="settings-group" aria-labelledby="support-heading">
            <h2 id="support-heading" class="group-title">{{ $t('page.user.navigation.support') }}</h2>
            <div class="settings-card">
              <div class="support">
                <NavigateStyleButton :title="$t('page.user.telegram_channel')" @action="navigateToTelegramChannel" />
              </div>
            </div>
            <UserDeleteAccountSection v-if="userInfo" />
          </section>
        </main>
        <UserPageSkeleton v-else key="skeleton" />
      </Transition>
    </div>
  </div>
</template>

<script lang="ts" setup>
import BookmarksTopBar from '~/components/BookmarkList/BookmarksTopBar.vue'
import NavigateStyleButton from '~/components/NavigateStyleButton.vue'
import OptionsBar from '~/components/OptionsBar.vue'
import AILanguageTips from '~/components/Tips/AILanguageTips.vue'
import UserDeleteAccountSection from '~/components/UserDeleteAccountSection.vue'
import UserExportSection from '~/components/UserExportSection.vue'
import UserImportSection from '~/components/UserImportSection.vue'
import UserLabSection from '~/components/UserLabSection.vue'
import UserPageSkeleton from '~/components/UserPageSkeleton.vue'

import { getPreferredLanguage, isSlaxReaderApp } from '../utils/environment'

import { RESTMethodPath } from '@commons/contracts/const'
import { type UserDetailInfo } from '@commons/contracts/interface'
import { showFeedbackModal } from '~/components/Modal'
import Toast, { ToastType } from '~/components/Toast'
import { useLabFeatures } from '~/composables/useLabFeatures'
import { useUserStore } from '~/stores/user'

const { t, te, locale } = useI18n()
const userStore = useUserStore()

const { start, finish } = useLoadingIndicator({
  duration: 5000,
  throttle: 200,
  estimatedProgress: (duration, elapsed) => (2 / Math.PI) * 100 * Math.atan(((elapsed / duration) * 100) / 50)
})

const avatarUrl = new URL('@images/user-default-avatar.png', import.meta.url).href
const userInfo = ref<UserDetailInfo>()
const loading = ref(true)
const detail = ref<HTMLElement>()
const labs = useLabFeatures()
const hasLabs = computed(() => labs.features.value.some(feature => te(`page.user.labs.${feature.key}.name`)))
const sections = computed(() => [
  ...(userInfo.value ? ['account'] : []),
  'preferences',
  ...(userInfo.value ? ['connections'] : []),
  ...(hasLabs.value ? ['features'] : []),
  'data',
  'support'
])
const activeSection = ref('account')
const route = useRoute()
let navigationTarget: string | undefined

const scrollToSection = (id: string, smooth = false) => {
  const target = detail.value?.querySelector<HTMLElement>(`[id="${id}"]`)
  if (!target) return
  target.scrollIntoView({ behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant', block: 'start' })
  if (smooth) {
    target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
  }
}

const goToSection = async (id: string) => {
  navigationTarget = id
  try {
    await navigateTo({ path: route.path, query: route.query, hash: `#${id}` }, { replace: true })
    await nextTick()
    scrollToSection(id, true)
    activeSection.value = id
  } finally {
    navigationTarget = undefined
  }
}

const updateActiveSection = () => {
  const groups = sections.value.map(id => detail.value?.querySelector<HTMLElement>(`#${id}`)).filter((element): element is HTMLElement => Boolean(element))
  if (!groups.length) return
  const offset = Number.parseFloat(window.getComputedStyle(groups[0]!).scrollMarginTop) || 104
  const current = groups.filter(element => element.getBoundingClientRect().top <= offset + 2).at(-1) ?? groups[0]
  const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
  activeSection.value = (atBottom ? groups.at(-1) : current)!.id
}

useEventListener('scroll', updateActiveSection, { passive: true })
useEventListener('resize', updateActiveSection, { passive: true })

watch(
  [loading, hasLabs, () => route.hash],
  async () => {
    if (loading.value) return
    await nextTick()
    const id = route.hash?.slice(1)
    if (id && id !== navigationTarget && [...sections.value, 'labs'].includes(id)) scrollToSection(id)
    updateActiveSection()
  },
  { flush: 'post' }
)

const languageOptions = computed<{ name: string; value: string }[]>(() => [
  {
    name: t('page.user.language_en'),
    value: 'en'
  },
  {
    name: t('page.user.language_zh'),
    value: 'zh'
  }
])

const aiLanguageOptions = computed<{ name: string; value: string }[]>(() => [
  {
    name: t('page.user.language_en'),
    value: 'en'
  },
  {
    name: t('page.user.language_zh'),
    value: 'zh'
  }
])

const preferredLang = isSlaxReaderApp() ? getPreferredLanguage() : undefined

if (!preferredLang && userStore.currentLocale !== locale.value) {
  userStore.changeLocale(locale.value)
}

const alertParams = (() => {
  const route = useRoute()
  const errorAlert = route.query.error_alert

  if (errorAlert) {
    const query = { ...route.query }
    delete query.error_alert

    navigateTo(
      {
        path: route.path,
        query
      },
      {
        replace: true
      }
    )

    Toast.showToast({
      text: String(errorAlert),
      type: ToastType.Error
    })
  }

  return errorAlert
})()

useHead({
  title: `${t('page.user.navigation.title')} - ${t('common.app.name')}`
})

onMounted(async () => {
  try {
    analyticsLog({
      event: 'setting_view'
    })
  } catch (e) {}

  start()
  await getUserDetailInfo()
  finish()
})

const languageOptionIndex = computed(() => {
  return languageOptions.value.findIndex(option => option.value === userStore.currentLocale) || 0
})

const aiLanguageOptionIndex = computed(() => {
  const aiLang = userInfo.value?.ai_lang
  if (!aiLang) return 0

  const mainLang = getPreferredLanguage(aiLang)
  const index = aiLanguageOptions.value.findIndex(option => option.value === mainLang)
  return index !== -1 ? index : 0
})

const getUserDetailInfo = async () => {
  const res = await request().get<UserDetailInfo>({
    url: RESTMethodPath.USER_INFO
  })

  userInfo.value = res
  loading.value = false
}

// Top bar search: go to the inbox with the keyword; the inbox page turns ?q= into a search.
// The clear (×) button emits '', which must not leave the settings page.
const searchBookmarks = (keyword: string) => {
  if (!keyword) return
  navigateTo({ path: '/bookmarks', query: { q: keyword } })
}

const feedbackClick = () => {
  showFeedbackModal({
    reportType: 'parse_error',
    title: '',
    email: userInfo.value?.email || '',
    params: {
      entry_point: 'settings'
    }
  })
}

const navigateToTelegramChannel = () => {
  window.open(`https://t.me/slax_app`)
}

const aiResponseLanguageSelect = async (index: number) => {
  const locale = aiLanguageOptions.value[index]
  if (!locale) return

  await request().post({
    url: RESTMethodPath.USER_INFO_SETTING,
    body: {
      key: 'ai_lang',
      value: locale.value
    }
  })
  await getUserDetailInfo()
}

const localeSelect = (index: number) => {
  const option = languageOptions.value[index]
  if (!option) return
  userStore.changeLocale(option.value)
}
</script>

<style lang="scss" scoped>
.user-info {
  --style: w-full relative flex justify-center items-start pb-88px;
}

// Leave room for the header above the two-column settings layout.
.content {
  width: 100%;
  max-width: 1200px;
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr);
  align-items: start;
  gap: 48px;
  padding: calc(var(--slax-header-height) + 32px) 24px 88px;

  @media (max-width: 768px) {
    display: block;
    padding-top: calc(var(--slax-header-height) + 16px);
    padding-left: 16px;
    padding-right: 16px;
  }
}

// 通用卡片样式
.settings-card {
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  padding: 24px;
}

.detail {
  display: flex;
  flex-direction: column;
  gap: 36px;
  min-width: 0;
  grid-column: 2;
}

.settings-nav {
  position: sticky;
  top: calc(var(--slax-header-height) + 32px);
  padding: 16px 12px;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);

  h1 {
    margin: 0 12px 20px;
    color: var(--slax-text);
    font-family: var(--slax-font-serif);
    font-size: var(--slax-fs-h2);
    font-weight: 500;
  }

  a {
    display: block;
    padding: 12px;
    border-radius: 8px;
    color: var(--slax-text-muted);
    font-size: var(--slax-fs-aux);
    line-height: 20px;
    text-decoration: none;
    white-space: nowrap;

    &:hover,
    &[aria-current='location'] {
      color: var(--slax-accent);
      background: var(--slax-accent-bg);
    }

    &[aria-current='location'] {
      font-weight: 600;
    }
    &:focus-visible {
      outline: 2px solid var(--slax-accent);
      outline-offset: 2px;
    }
  }
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
  scroll-margin-top: calc(var(--slax-header-height) + 24px);
  &:focus {
    outline: none;
  }
}

.group-title {
  margin: 0;
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-h2);
  line-height: 1.4;
  font-weight: 500;
}

:deep(#labs) {
  scroll-margin-top: calc(var(--slax-header-height) + 24px);
}

@media (max-width: 768px) {
  .settings-nav {
    top: var(--slax-header-height);
    z-index: 20;
    margin-bottom: 24px;
    padding: 8px;
    background: var(--slax-topbar-bg);
    backdrop-filter: var(--slax-blur);

    h1 {
      font-size: var(--slax-fs-card);
      margin: 4px 8px 8px;
    }
    a {
      padding: 10px 12px;
    }
  }

  .settings-nav-links {
    display: flex;
    overflow-x: auto;
    gap: 4px;
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
  }
  .settings-group,
  :deep(#labs) {
    scroll-margin-top: calc(var(--slax-header-height) + 112px);
  }
  .settings-card {
    padding: 20px;
  }
}

// 语言设置行
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  position: relative;
  z-index: 1;

  // 第一行下拉需要浮在第二行之上
  &:first-child {
    z-index: 2;
  }
}

.settings-label {
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-muted);
  line-height: 1.5;
}

.settings-label-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.settings-divider {
  height: 1px;
  background: var(--slax-border);
  margin: 8px 0;
}

// 个人信息区
.personal {
  display: flex;
  align-items: center;
  gap: 20px;
}

.avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.personal-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.username {
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-card);
  color: var(--slax-text);
  font-weight: 600;
  line-height: 1.45;
}

.email {
  overflow-wrap: anywhere;
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-light);
  line-height: 1.5;
}

// 帮助支持
.support {
  margin-top: 0;
}
</style>
