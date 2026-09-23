/**
 * Whether the snapshot detail page should auto-open its right side panel.
 *
 * Per device, not per account: screen width is a device property, and the
 * habit "don't pop the panel on this laptop" does not change with the login.
 *
 * - no record: open only when the window fits article + panel side by side
 * - 'closed': the user collapsed it once, stay collapsed
 * - 'open':   the user opened it by hand, open regardless of width
 * Last user action wins.
 *
 * Read once at page load, written on user clicks, so plain localStorage is
 * enough (same pattern as useOwnerInfo.ts); no reactive storage needed.
 */
export const SIDE_PANEL_AUTO_OPEN_KEY = 'slax:snapshot-panel-auto-open'

/** Article column width; mirrors `contentW` in upstream useSnapshotLayout.ts. */
export const SNAPSHOT_CONTENT_WIDTH = 820

export type SidePanelAutoOpen = 'open' | 'closed' | ''

const read = (): SidePanelAutoOpen => {
  if (typeof localStorage === 'undefined') return ''
  try {
    const v = localStorage.getItem(SIDE_PANEL_AUTO_OPEN_KEY)
    return v === 'open' || v === 'closed' ? v : ''
  } catch {
    return ''
  }
}

const write = (v: Exclude<SidePanelAutoOpen, ''>) => {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SIDE_PANEL_AUTO_OPEN_KEY, v)
  } catch {
    // private mode / storage disabled: behave as if nothing was remembered
  }
}

export function useSidePanelPreference() {
  const shouldAutoOpen = (windowWidth: number, panelWidth: number): boolean => {
    const pref = read()
    if (pref === 'closed') return false
    if (pref === 'open') return true
    return windowWidth >= SNAPSHOT_CONTENT_WIDTH + panelWidth
  }

  const markOpened = () => write('open')
  const markClosed = () => write('closed')

  return { shouldAutoOpen, markOpened, markClosed }
}
