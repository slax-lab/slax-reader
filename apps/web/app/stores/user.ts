import { isSlaxReaderApp } from '../utils/environment'

import { RESTMethodPath } from '@commons/types/const'
import { type UserInfo } from '@commons/types/interface'
import { useCookies } from '@vueuse/integrations/useCookies'
import { type _GettersTree, defineStore } from 'pinia'

interface UserState {
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
  getUserInfo: (options?: { refresh: boolean }) => Promise<UserInfo>
  clearUserInfo: () => Promise<void>
  changeLocale: (locale: string) => Promise<void>
  updatePayTimeRecord: () => void
  clearPayTimeRecord: () => void
  refreshUserToken: () => Promise<void>
  changeUserSetting: (key: string, value: string) => Promise<void>
  changeLocalLocale: (locale: string) => Promise<void>
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
      const resp = await request().get<UserInfo>({
        url: RESTMethodPath.ME
      })

      if (!resp) {
        throw new Error('refresh user info failed')
      }

      this.user = resp
      if (this.locale !== resp.lang) {
        this.changeLocalLocale(resp.lang)
      }
      return resp
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
      this.user = null
    },
    async changeLocalLocale(locale: string) {
      if (['en', 'zh'].indexOf(locale) === -1) {
        locale = 'en'
      }

      const i18n = useNuxtApp().$i18n
      this.locale = locale
      i18n.setLocale(locale as 'en' | 'zh')
    },
    async changeLocale(locale: string) {
      if (this.locale === locale) return
      this.changeUserSetting('lang', locale).then(() => {
        this.refreshUserToken()
        this.changeLocalLocale(locale)
      })
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
      request()
        .post<{ token: string }>({
          url: RESTMethodPath.TOKEN_REFRESH
        })
        .then(res => {
          if (!res) return

          const config = useRuntimeConfig().public
          const { set } = useCookies()
          set(config.COOKIE_TOKEN_NAME as string, res.token, { path: '/', expires: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), domain: `${config.COOKIE_DOMAIN}` })
        })
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

      const { get } = useCookies()
      const token = get('token')
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
