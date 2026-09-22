// Labs: per-user switches for features still being tried out.
// State lives in useState (not the persisted user store) so a stale switch never comes back from localStorage.
import { RequestError } from '@commons/frontend-utils/request'

import { RESTMethodPath } from '@commons/types/const'
import type { LabFeature } from '@commons/types/interface'
import Toast, { ToastType } from '~/components/Toast'

export const LAB_FEATURE_DISABLED = 'LAB_FEATURE_DISABLED'

// Mirrors the backend gate: a YouTube video URL (watch / youtu.be / shorts / live / embed with an 11-char id)
const YOUTUBE_VIDEO_RE = /^https?:\/\/(?:(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|(?:shorts|live|embed)\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i

// URL → feature key. Only used by clients that write locally without asking the server first.
const GATED: Array<{ key: string; test: (url: string) => boolean }> = [{ key: 'youtube', test: url => YOUTUBE_VIDEO_RE.test(url) }]

export const gatedFeatureForUrl = (url: string): string | null => GATED.find(g => g.test(url))?.key ?? null

export const useLabFeatures = () => {
  const features = useState<LabFeature[]>('lab-features', () => [])
  const loaded = useState<boolean>('lab-features-loaded', () => false)

  const t = (key: string) => useNuxtApp().$i18n.t(key)

  const fetch = async () => {
    const res = await request().get<{ features: LabFeature[] }>({ url: RESTMethodPath.USER_LABS })
    features.value = res?.features ?? []
    loaded.value = true
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
