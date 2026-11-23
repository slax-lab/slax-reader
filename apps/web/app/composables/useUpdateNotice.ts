// Which kind of notice an outdated page shows: a newer build exists, or loading has already broken.
export type UpdateNoticeKind = 'available' | 'outdated'

export interface UpdateNoticeState {
  kind: UpdateNoticeKind | null
  /** The newer build the notice refers to, when known. */
  buildId: string | null
  /** The notice key the user closed; a different key shows the notice again. */
  dismissedKey: string | null
}

const noticeKey = (state: Pick<UpdateNoticeState, 'kind' | 'buildId'>) => (state.kind === 'outdated' ? 'outdated' : `available:${state.buildId ?? ''}`)

/** Shared state for the top-right new-version notice. */
export const useUpdateNotice = () => {
  const state = useState<UpdateNoticeState>('slax-update-notice', () => ({ kind: null, buildId: null, dismissedKey: null }))

  const report = (kind: UpdateNoticeKind, buildId: string | null = null) => {
    // A broken load is never downgraded to the softer "new version" wording.
    if (state.value.kind === 'outdated' && kind === 'available') return
    state.value = { ...state.value, kind, buildId: buildId ?? state.value.buildId }
  }

  const visible = computed(() => state.value.kind !== null && state.value.dismissedKey !== noticeKey(state.value))
  const dismiss = () => {
    if (state.value.kind) state.value = { ...state.value, dismissedKey: noticeKey(state.value) }
  }

  return { state, visible, report, dismiss }
}
