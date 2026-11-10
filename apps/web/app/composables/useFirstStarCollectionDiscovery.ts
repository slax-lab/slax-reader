import CursorToast from '~/components/CursorToast'
import { useAccountContext } from '~/composables/useAccountContext'
import { useUserStore } from '~/stores/user'

export const FIRST_STAR_CUE_DURATION = 4000
const FIRST_STAR_CUE_STORAGE_PREFIX = 'slax:first-star-collection-cue:'
const STARRED_PAGE_URL = '/bookmarks?filter=starred'

export type FirstStarCueResult = 'presented' | 'not-applicable'

export const firstStarCueStorageKey = (userId: string | number) => `${FIRST_STAR_CUE_STORAGE_PREFIX}${userId}`

/**
 * A call path supplies the starred count it knows before its own write. A locally known zero and
 * an unknown count both qualify, so prefetches never delay the cue; a known non-zero count does not.
 */
export const isLocallyFirstStar = (wasStarred: boolean, starredCountBefore: number | null | undefined) =>
  !wasStarred && (starredCountBefore == null || starredCountBefore === 0)

const readCueFlag = (key: string) => {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

const writeCueFlag = (key: string) => {
  try {
    window.localStorage.setItem(key, '1')
    return true
  } catch {
    return false
  }
}

export interface FirstStarCueOptions {
  // True when this is an unstarred bookmark whose local count is zero or unknown.
  isFirstStar: boolean
  anchor?: HTMLElement | null
  baseContainer?: HTMLElement | null
  // Test seam; production callers resolve the signed-in account automatically.
  userId?: string | number | null
}

interface FirstStarCueDependencies {
  t: (key: string) => string
  resolveUserId: () => string | number | null
  openStarred: () => void
}

const runFirstStarCue = async (options: FirstStarCueOptions, deps: FirstStarCueDependencies): Promise<FirstStarCueResult> => {
  if (!import.meta.client || !options.isFirstStar) return 'not-applicable'

  const userId = options.userId ?? deps.resolveUserId()
  if (userId == null || userId === '') return 'not-applicable'

  const storageKey = firstStarCueStorageKey(userId)
  if (readCueFlag(storageKey)) return 'not-applicable'

  CursorToast.showToast({
    text: deps.t('page.bookmarks_index.starred_share.first_star_cue'),
    action: {
      text: deps.t('page.bookmarks_index.starred_share.view_starred'),
      onClick: deps.openStarred
    },
    trackDom: options.anchor ?? null,
    baseContainer: options.baseContainer ?? undefined,
    duration: FIRST_STAR_CUE_DURATION
  })

  // Presentation already happened; a flag write failure may repeat the cue in this browser
  // but must not append a second Toast.
  writeCueFlag(storageKey)
  return 'presented'
}

/**
 * Captures the Vue/Nuxt context dependencies while the component setup is active. Callers invoke
 * the returned function after awaiting the star write, where composables such as `useI18n` can no
 * longer reach the component instance.
 *
 * Best-effort first-star discovery. It never affects star persistence and never throws.
 *
 * - Returns `not-applicable` when this is not a first-star candidate, the per-account flag is set,
 *   or the cue cannot be presented; the caller keeps its ordinary success feedback.
 * - Returns `presented` after showing the action-capable cue and writing the per-account flag.
 */
export const useFirstStarCollectionCue = (): ((options: FirstStarCueOptions) => Promise<FirstStarCueResult>) => {
  const { t } = useI18n()
  const account = useAccountContext()
  const userStore = useUserStore()

  // The token-derived identity changes immediately on account switch; the user store may lag.
  const resolveUserId = (): string | number | null => {
    const liveId = account.context.value.serverUserId ?? account.sessionOwner.value
    if (liveId != null && liveId !== '') return liveId

    return userStore.userInfo?.userId ?? null
  }

  return options =>
    runFirstStarCue(options, {
      t,
      resolveUserId,
      openStarred: () => navigateTo(STARRED_PAGE_URL)
    }).catch(() => 'not-applicable')
}
