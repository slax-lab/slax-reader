/** Controlled input diagnostics contain counts and flags, never selected text or annotation IDs. */
export interface ReaderInputSnapshot {
  sequence: number
  touchStarts: number
  touchEnds: number
  touchCancels: number
  bubbleTouchStarts: number
  bubbleTouchEnds: number
  bubbleTouchCancels: number
  clicks: number
  selectionChanges: number
  sourceMarkClicks: number
  sourceSelections: number
  sourceDeselections: number
  sourceErrors: number
  lastDomEventCode: number
  lastSourceEventCode: number
  lastTouchCount: number
  lastTouchHadStart: boolean
  lastTouchRangePresent: boolean
  lastTouchRangeCollapsed: boolean | null
  lastTouchMovedX: number | null
  lastTouchMovedY: number | null
  lastTargetClosestMark: boolean
  lastHitClosestMark: boolean
  lastMarkInfoPresent: boolean
  lastMarkCommentCount: number
  monitorPresent: boolean
  monitoring: boolean
  pointerDown: boolean
  pendingSelection: boolean
  selectionTimerActive: boolean
  lastSelectionTextLength: number
  rangePresent: boolean
  rangeCollapsed: boolean | null
  rangeInsideMonitor: boolean
  rangeSuppressed: boolean
}

export type ReaderInputObservation =
  | {pageId: string; stage: 'dom'; snapshot: ReaderInputSnapshot}
  | {pageId: string; stage: 'received'; eventCode: number; parsed: boolean; markValid: boolean}
  | {pageId: string; stage: 'screen'; eventCode: number; markValid: boolean; accountActive: boolean}

// 0 unknown/rejected, 1 mark click, 2 text selected, 3 text cleared,
// 4 marks changed, 5 tap, 6 selection error. No source payload is retained.
export function readerInputEventCode(type: string): number {
  return ['markClicked', 'textSelected', 'textDeselected', 'markItemInfosChanged', 'tap', 'selectionError'].indexOf(type) + 1
}

const counts = ['sequence', 'touchStarts', 'touchEnds', 'touchCancels', 'bubbleTouchStarts', 'bubbleTouchEnds', 'bubbleTouchCancels', 'clicks', 'selectionChanges', 'sourceMarkClicks',
  'sourceSelections', 'sourceDeselections', 'sourceErrors', 'lastTouchCount', 'lastMarkCommentCount', 'lastSelectionTextLength'] as const
const flags = ['lastTouchHadStart', 'lastTouchRangePresent', 'lastTargetClosestMark', 'lastHitClosestMark', 'lastMarkInfoPresent', 'monitorPresent',
  'monitoring', 'pointerDown', 'pendingSelection', 'selectionTimerActive', 'rangePresent', 'rangeInsideMonitor', 'rangeSuppressed'] as const
const keys = new Set<string>([...counts, ...flags, 'lastDomEventCode', 'lastSourceEventCode', 'lastTouchMovedX', 'lastTouchMovedY', 'rangeCollapsed', 'lastTouchRangeCollapsed'])
const bounded = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000
const count = (value: unknown): value is number => bounded(value) && Number.isSafeInteger(value)

/** Reject extra fields too: diagnostics must never carry document or credential data. */
export function parseReaderInputSnapshot(value: unknown): ReaderInputSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== keys.size || Object.keys(item).some(key => !keys.has(key)) ||
      !counts.every(key => count(item[key])) || !flags.every(key => typeof item[key] === 'boolean') ||
      !count(item.lastDomEventCode) || item.lastDomEventCode > 5 || !count(item.lastSourceEventCode) || item.lastSourceEventCode > 6 ||
      !['lastTouchMovedX', 'lastTouchMovedY'].every(key => item[key] === null || bounded(item[key])) ||
      !['rangeCollapsed', 'lastTouchRangeCollapsed'].every(key => item[key] === null || typeof item[key] === 'boolean')) return null
  return {...item} as unknown as ReaderInputSnapshot
}
