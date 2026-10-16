import React, {useSyncExternalStore} from 'react'
import {CommentPanel} from './CommentPanel'
import {OutlineSheet} from './OutlineSheet'
import {OverviewDialog, OverviewExcerpt} from '../OverviewViews'
import type {FeatureState, ReaderAiState} from '../state/feature-state'

export function ReaderAiExcerpt({state, ...props}: Omit<React.ComponentProps<typeof OverviewExcerpt>, 'content'> & {state: FeatureState<ReaderAiState>}) {
  const value = useSyncExternalStore(state.subscribe, state.getSnapshot)
  return <OverviewExcerpt {...props} content={value.content} />
}
export function ReaderAiOutline({state, ...props}: Omit<React.ComponentProps<typeof OutlineSheet>, 'markdown' | 'pending' | 'busy' | 'error'> & {state: FeatureState<ReaderAiState>}) {
  const value = useSyncExternalStore(state.subscribe, state.getSnapshot)
  return <OutlineSheet {...props} markdown={value.content} pending={value.pending} busy={value.busy} error={value.error} />
}
export function ReaderAiOverview({state, isPdf, pdfTextMessage, loadingLabel, ...props}: Omit<React.ComponentProps<typeof OverviewDialog>, 'content' | 'takeaways'> & {
  state: FeatureState<ReaderAiState>; isPdf: boolean; pdfTextMessage: string | null; loadingLabel: string
}) {
  const value = useSyncExternalStore(state.subscribe, state.getSnapshot)
  return <OverviewDialog {...props} content={value.content || (isPdf ? pdfTextMessage || value.error || (value.busy ? loadingLabel : '') : '')} takeaways={value.takeaways} />
}
export function ReaderCommentPanel({draftState, ...props}: Omit<React.ComponentProps<typeof CommentPanel>, 'draft' | 'onDraft'> & {draftState: FeatureState<string>}) {
  const draft = useSyncExternalStore(draftState.subscribe, draftState.getSnapshot)
  return <CommentPanel {...props} draft={draft} onDraft={draftState.set} />
}
