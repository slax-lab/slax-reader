export const IN_APP_BROWSER_TIP_STATE_KEY = 'slax:in-app-browser-tip-state:v1'
export const IN_APP_BROWSER_TIP_COOLDOWN_MS = 60 * 60 * 1000

export interface InAppBrowserTipState {
  manualCloseCount: number
  cooldownUntil: number
}

export const EMPTY_IN_APP_BROWSER_TIP_STATE: InAppBrowserTipState = {
  manualCloseCount: 0,
  cooldownUntil: 0
}

const isValidState = (value: unknown): value is InAppBrowserTipState => {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<InAppBrowserTipState>
  return Number.isFinite(state.manualCloseCount)
    && Number.isInteger(state.manualCloseCount)
    && state.manualCloseCount >= 0
    && state.manualCloseCount <= 2
    && Number.isFinite(state.cooldownUntil)
    && state.cooldownUntil >= 0
    && (state.manualCloseCount === 2 ? state.cooldownUntil > 0 : state.cooldownUntil === 0)
}

const copyState = (state: InAppBrowserTipState): InAppBrowserTipState => ({ ...state })
let memoryState = copyState(EMPTY_IN_APP_BROWSER_TIP_STATE)
let storageWriteFailed = false

export const readInAppBrowserTipState = (now = Date.now()): InAppBrowserTipState => {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(IN_APP_BROWSER_TIP_STATE_KEY)
  } catch {
    return copyState(memoryState)
  }

  if (!raw) return copyState(storageWriteFailed ? memoryState : EMPTY_IN_APP_BROWSER_TIP_STATE)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  if (!isValidState(parsed)) {
    const reset = copyState(EMPTY_IN_APP_BROWSER_TIP_STATE)
    writeInAppBrowserTipState(reset)
    return reset
  }
  if (parsed.cooldownUntil > 0 && parsed.cooldownUntil <= now) {
    const reset = copyState(EMPTY_IN_APP_BROWSER_TIP_STATE)
    writeInAppBrowserTipState(reset)
    return reset
  }
  memoryState = copyState(parsed)
  storageWriteFailed = false
  return copyState(parsed)
}

export const writeInAppBrowserTipState = (state: InAppBrowserTipState): void => {
  memoryState = copyState(state)
  try {
    window.localStorage.setItem(IN_APP_BROWSER_TIP_STATE_KEY, JSON.stringify(state))
    storageWriteFailed = false
  } catch {
    // Storage can be disabled in privacy-restricted embedded browsers.
    storageWriteFailed = true
    memoryState = copyState(state)
  }
}

export const recordInAppBrowserTipManualClose = (now = Date.now()): InAppBrowserTipState => {
  const current = readInAppBrowserTipState(now)
  const next: InAppBrowserTipState = current.manualCloseCount >= 1
    ? { manualCloseCount: 2, cooldownUntil: now + IN_APP_BROWSER_TIP_COOLDOWN_MS }
    : { manualCloseCount: 1, cooldownUntil: 0 }
  writeInAppBrowserTipState(next)
  return next
}

export const isInAppBrowserTipCoolingDown = (now = Date.now()): boolean => {
  const state = readInAppBrowserTipState(now)
  return state.cooldownUntil > now
}
