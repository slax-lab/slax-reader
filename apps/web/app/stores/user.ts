import { createAccountLocaleRequest } from '../utils/accountLocaleRequest'
import { readStringCookie, requireConfiguredCookieName } from '../utils/authCookie'
import { notifyExtensionAccountLocaleInvalidated } from '../utils/extensionLocale'
import { existingUserLocaleTasks, getUserLocaleTasks, type LocaleUserState } from '../utils/userLocaleTasks'

import type { AppLocale } from '@commons/frontend-types/locale'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { type UserInfo } from '@slax-reader/contracts/interface'
import { useCookies } from '@vueuse/integrations/useCookies'
import { type _GettersTree, defineStore } from 'pinia'

interface UserState {
  confirmedAccountLocale: { accountKey: string; locale: AppLocale } | null
  user: UserInfo | null
  locale: string
  payTimeRecord: number | null // 负责记录付费的时间
  lastCloseInstallExtTipsDates: number[] // 负责记录最近一次关闭安装扩展提示的时间
  shareTipsClicked: boolean // 负责记录是否点击过分享引导提示
  lastRefreshTokenDate: number // 负责记录最近一次刷新token的时间
  lastRequestPushPermissionDate: number // 负责记录最近一次请求推送权限的时间
  subscribeCollectionTimeRecord: Record<string, { time: number; subscribed: boolean; cancelled: boolean; deleted: boolean }> | null // 负责记录订阅用户操作的时间和状态，key为用户的订阅code
}

interface UserGetters extends _GettersTree<UserState> {
  userInfo: (state: UserState) => UserInfo | null
  currentLocale: (state: UserState) => string
  isJustPaid: (state: UserState) => boolean
  isSubscriptionExpired: (state: UserState) => boolean
  isLogin: () => boolean
  showCloseInstallExtTips: (state: UserState) => { canShow: boolean; showedAlready: boolean }
  showShareTips: (state: UserState) => boolean
  canRequetPushPermission: (state: UserState) => boolean
}

interface UserActions {
  refreshUserInfo: () => Promise<UserInfo>
  refreshServerUserInfo: (signal?: AbortSignal) => Promise<UserInfo>
  getUserInfo: (options?: { refresh: boolean }) => Promise<UserInfo>
  clearUserInfo: () => Promise<void>
  changeLocale: (locale: string) => Promise<void>
  updatePayTimeRecord: () => void
  clearPayTimeRecord: () => void
  refreshUserToken: () => Promise<void>
  changeUserSetting: (key: string, value: string) => Promise<void>
  changeLocalLocale: (locale: string, displayOnly?: boolean) => Promise<void>
  updateCloseInstallExtTipsDate: () => void
  updateShareTipsClicked: () => void
  checkAndRefreshUserToken: () => void
  updateLastRequestPushPermissionDate: () => void
  getSubscribeCollectionTimeRecord: (collectionCode: string) => { subscribed: boolean; cancelled: boolean; deleted: boolean } | null
  isJustSubscribeCollection: (collectionCode: string, status: { subscribed: boolean; cancelled: boolean; deleted: boolean }) => boolean
  updateSubscribeCollectionTimeRecord: (collectionCode: string, status: { subscribed: boolean; cancelled: boolean; deleted: boolean }) => void
  clearSubscribeCollectionTimeRecord: (collectionCode: string) => void
}

export const useUserStore = defineStore<'user', UserState, UserGetters, UserActions>('user', {
  state: () => {
    return {
      user: null,
      confirmedAccountLocale: null,
      locale: useI18n()?.locale?.value,
      payTimeRecord: null,
      lastCloseInstallExtTipsDates: [],
      shareTipsClicked: false,
      lastRefreshTokenDate: 0,
      lastRequestPushPermissionDate: 0,
      subscribeCollectionTimeRecord: null
    }
  },
  getters: {
    userInfo: (state: UserState) => state.user,
    currentLocale: (state: UserState) => state.locale || 'en',
    isJustPaid: (state: UserState) => {
      if (!state.payTimeRecord) return false
      const now = Date.now()
      return now - state.payTimeRecord < 1000 * 60 * 10 // 10分钟内付费这个都为true
    },
    isSubscriptionExpired: (state: UserState) => {
      if (!state.user) return true

      return checkUserSubscribedIsExpired(state.user)
    },
    isLogin: () => haveRequestToken(),
    showCloseInstallExtTips: (state: UserState) => {
      return {
        canShow: !state.lastCloseInstallExtTipsDates || state.lastCloseInstallExtTipsDates.length <= 1,
        showedAlready: state.lastCloseInstallExtTipsDates && state.lastCloseInstallExtTipsDates.length > 0
      }
    },
    showShareTips: (state: UserState) => {
      return !state.shareTipsClicked
    },
    canRequetPushPermission: (state: UserState) => {
      return state.lastRequestPushPermissionDate === 0 || Date.now() - state.lastRequestPushPermissionDate > 1000 * 60 * 60
    }
  },
  actions: {
    async refreshUserInfo(): Promise<UserInfo> {
      return this.refreshServerUserInfo()
    },
    // Identity-sensitive flows bypass the plugin's optional offline fallback.
    async refreshServerUserInfo(signal?: AbortSignal): Promise<UserInfo> {
      return localeTasksForStore(this).read(signal)
    },
    async getUserInfo(options?: { refresh: boolean }): Promise<UserInfo> {
      if (options && options.refresh && this.isLogin) {
        await this.refreshUserInfo()
      }

      if (!this.user) {
        throw new Error('get user info failed')
      }

      return this.user
    },
    async clearUserInfo() {
      existingUserLocaleTasks(this)?.clear()
      this.user = null
      this.confirmedAccountLocale = null
    },
    async changeLocalLocale(locale: string, displayOnly = false) {
      return localeTasksForStore(this).local(locale, displayOnly)
    },
    async changeLocale(locale: string) {
      return localeTasksForStore(this).save(locale)
    },
    async changeUserSetting(key: string, value: string) {
      return await request().post({
        url: RESTMethodPath.USER_INFO_SETTING,
        body: {
          key,
          value
        }
      })
    },
    async refreshUserToken() {
      return localeTasksForStore(this).refreshToken()
    },
    updatePayTimeRecord() {
      this.payTimeRecord = Date.now()
    },
    clearPayTimeRecord() {
      this.payTimeRecord = null
    },
    updateCloseInstallExtTipsDate() {
      this.lastCloseInstallExtTipsDates = [...this.lastCloseInstallExtTipsDates, Date.now()]
    },
    updateShareTipsClicked() {
      this.shareTipsClicked = true
    },
    checkAndRefreshUserToken() {
      const now = Date.now()
      if (now - this.lastRefreshTokenDate < 60 * 60 * 24 * 1000) {
        return
      }

      const token = readStringCookie(useRuntimeConfig().public.COOKIE_TOKEN_NAME)
      if (!token) {
        return
      }

      this.lastRefreshTokenDate = now
      this.refreshUserToken()
    },
    updateLastRequestPushPermissionDate() {
      this.lastRequestPushPermissionDate = Date.now()
    },
    getSubscribeCollectionTimeRecord(collectionCode: string) {
      if (!this.subscribeCollectionTimeRecord || !this.subscribeCollectionTimeRecord[collectionCode]) return null

      return {
        subscribed: this.subscribeCollectionTimeRecord[collectionCode].subscribed,
        cancelled: this.subscribeCollectionTimeRecord[collectionCode].cancelled,
        deleted: this.subscribeCollectionTimeRecord[collectionCode].deleted
      }
    },
    isJustSubscribeCollection(collectionCode: string, status: { subscribed: boolean; cancelled: boolean; deleted: boolean }) {
      if (!this.subscribeCollectionTimeRecord) return false
      if (!this.subscribeCollectionTimeRecord[collectionCode]) return false

      const record = this.subscribeCollectionTimeRecord[collectionCode]
      if (status.subscribed !== record.subscribed || status.deleted !== record.deleted || status.cancelled !== record.cancelled) {
        // 出现不一致说明状态出现了变更
        return false
      }

      const now = Date.now()
      return now - record.time < 1000 * 60 * 10 // 状态相同的情况下，10分钟内订阅这个都为 true
    },
    updateSubscribeCollectionTimeRecord(collectionCode: string, status: { subscribed: boolean; cancelled: boolean; deleted: boolean }) {
      if (!this.subscribeCollectionTimeRecord) {
        this.subscribeCollectionTimeRecord = {}
      }

      this.subscribeCollectionTimeRecord[collectionCode] = {
        time: Date.now(),
        ...status
      }
    },
    clearSubscribeCollectionTimeRecord(collectionCode: string) {
      if (!this.subscribeCollectionTimeRecord) {
        return
      }

      const res = Object.fromEntries(Object.entries(this.subscribeCollectionTimeRecord).filter(([key]) => key !== collectionCode))
      if (Object.keys(res).length === 0) {
        this.subscribeCollectionTimeRecord = null
      } else {
        this.subscribeCollectionTimeRecord = res
      }
    }
  },
  persist: [
    {
      storage: piniaPluginPersistedstate.localStorage()
    }
  ]
})

// Capture Nuxt and cookie handles before any task enters an async queue.
export const localeTasksForStore = (store: LocaleUserState) => {
  const existing = existingUserLocaleTasks(store)
  if (existing) return existing
  const app = useNuxtApp()
  const config = useRuntimeConfig().public
  const cookies = useCookies()
  const serverToken = import.meta.server ? getUserToken() : undefined
  const auth = useAuth()
  return getUserLocaleTasks(store, {
    api: createAccountLocaleRequest(),
    getToken: () => (import.meta.server ? serverToken : readStringCookie(config.COOKIE_TOKEN_NAME, cookies)),
    setToken: token => {
      const cookieName = requireConfiguredCookieName(config.COOKIE_TOKEN_NAME)
      const cookieDomain = typeof config.COOKIE_DOMAIN === 'string' ? config.COOKIE_DOMAIN : ''
      cookies.set(cookieName, token, {
        path: '/',
        expires: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        ...(cookieDomain ? { domain: cookieDomain } : {})
      })
    },
    apply: locale => app.runWithContext(() => app.$i18n.setLocale(locale)),
    notify: notifyExtensionAccountLocaleInvalidated,
    expire: () =>
      app.runWithContext(async () => {
        await auth.clearAuth()
        await app.runWithContext(() => navigateTo('/login'))
      })
  })
}
