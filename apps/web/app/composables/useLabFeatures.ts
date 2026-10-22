// Labs: per-user switches for features still being tried out.
// State lives in useState (not the persisted user store) so a stale switch never comes back from localStorage.
import { RequestError } from '@commons/frontend-utils/request'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { LabFeature } from '@slax-reader/contracts/interface'
import Toast, { ToastType } from '~/components/Toast'
import { getUserToken } from '~/utils/request'
import { getTokenUserId } from '~/utils/sessionOwner'

const requests = new WeakMap<object, { owner: string | null; promise: Promise<void> }>()

export const LAB_FEATURE_DISABLED = 'LAB_FEATURE_DISABLED'

// Mirrors the backend gate: a YouTube video URL (watch / youtu.be / shorts / live / embed with an 11-char id)
const YOUTUBE_VIDEO_RE = /^https?:\/\/(?:(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|(?:shorts|live|embed)\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i

// URL → feature key. Only used by clients that write locally without asking the server first.
const GATED: Array<{ key: string; test: (url: string) => boolean }> = [{ key: 'youtube', test: url => YOUTUBE_VIDEO_RE.test(url) }]

export const gatedFeatureForUrl = (url: string): string | null => GATED.find(g => g.test(url))?.key ?? null

export const useLabFeatures = () => {
  const app = useNuxtApp()
  const features = useState<LabFeature[]>('lab-features', () => [])
  const loaded = useState<boolean>('lab-features-loaded', () => false)

  const owner = useState<string | null | undefined>('lab-features-owner', () => undefined)
  const currentOwner = (): string | null => {
    let account: string | null = null
    app.runWithContext(() => {
      account = getTokenUserId(getUserToken())
    })
    return account
  }

  const t = (key: string) => useNuxtApp().$i18n.t(key)

  const fetch = (force = false): Promise<void> => {
    const account = currentOwner()
    if (owner.value !== account) {
      features.value = []
      loaded.value = false
      owner.value = account
    }
    const pending = requests.get(app)
    if (pending?.owner === account) return pending.promise
    if (loaded.value && !force) return Promise.resolve()
    const entry = { owner: account, promise: Promise.resolve() }
    entry.promise = request().get<{ features: LabFeature[] }>({ url: RESTMethodPath.USER_LABS })
      .then(res => {
        if (requests.get(app) !== entry || currentOwner() !== account) return
        features.value = res?.features ?? []
        loaded.value = true
      })
      .finally(() => {
        if (requests.get(app) === entry) requests.delete(app)
      })
    requests.set(app, entry)
    return entry.promise
  }

  const isEnabled = (key: string) => features.value.some(f => f.key === key && f.enabled)

  // Optimistic: flip first, roll back and toast if the server says no
  const toggle = async (key: string) => {
    const feature = features.value.find(f => f.key === key)
    if (!feature || feature.status === 'graduated') return
    const next = !feature.enabled
    feature.enabled = next
    try {
      await request().post({
        url: next ? RESTMethodPath.USER_INFO_ENABLE_SETTING : RESTMethodPath.USER_INFO_DISABLE_SETTING,
        body: { key: `lab:${key}` }
      })
      feature.enabled_at = next ? new Date().toISOString() : null
    } catch {
      feature.enabled = !next
      Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
    }
  }

  // true when the URL needs a switch the user has not turned on. Unknown state (not fetched yet) never blocks.
  const isBlocked = (url: string) => {
    const key = gatedFeatureForUrl(url)
    return !!key && loaded.value && !isEnabled(key)
  }

  const showBlockedToast = (text: string) =>
    Toast.showToast({
      text,
      type: ToastType.Error,
      duration: 6000,
      action: { text: t('common.tips.lab_open'), onClick: () => navigateTo('/user#labs') }
    })

  // Client-side copy for a URL isBlocked() rejected (no server round trip happened)
  const blockedMessage = (url: string) => {
    const key = gatedFeatureForUrl(url)
    return key ? t(`page.user.labs.${key}.blocked`) : ''
  }

  // For request errorInterceptors: true when the error was the Labs gate and a toast was shown
  const handleSaveError = (err: unknown): boolean => {
    if (!(err instanceof RequestError) || err.name !== LAB_FEATURE_DISABLED) return false
    showBlockedToast(err.message)
    return true
  }

  return { features, loaded, fetch, isEnabled, toggle, isBlocked, blockedMessage, showBlockedToast, handleSaveError }
}

export default useLabFeatures
