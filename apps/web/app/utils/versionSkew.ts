// A Worker script or WASM request answered with the HTML shell, which Pages serves for any missing
// `/_nuxt/` file after a release replaced it. Only these signatures mean "refresh to the new build";
// storage, quota, lock, and timeout failures are not fixed by a refresh.
const SKEW_SIGNATURES = [
  // `WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f` (`<!DO`).
  /expected magic word 00 61 73 6d, found 3c/i,
  // V8 and JavaScriptCore parsing HTML as a script.
  /Unexpected token '<'/i,
  /Unexpected token <\b/i,
  // A module or Worker script rejected for its HTML MIME type.
  /MIME type (?:of )?['"]?text\/html/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i
]

// Initialization errors wrap the browser error a few levels deep at most.
const MAX_CAUSE_DEPTH = 5

const messageOf = (error: unknown, depth = 0): string => {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    const cause = (error as { cause?: unknown }).cause
    const causeMessage = cause && cause !== error && depth < MAX_CAUSE_DEPTH ? messageOf(cause, depth + 1) : ''
    return [typeof message === 'string' ? message : '', causeMessage].join(' ')
  }
  return ''
}

/** Whether an error shows that this page's build assets were replaced by a newer release. */
export const isVersionSkewError = (error: unknown): boolean => {
  try {
    const message = messageOf(error)
    return !!message && SKEW_SIGNATURES.some(signature => signature.test(message))
  } catch {
    return false
  }
}
