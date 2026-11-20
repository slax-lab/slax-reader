import { useClientErrorLog } from '~/utils/clientErrorLog'

import { installGlobalErrorCapture } from '@commons/frontend-utils/errorLog'
import type { ComponentPublicInstance } from 'vue'

const componentName = (instance: ComponentPublicInstance | null | undefined) => instance?.$options?.name || instance?.$options?.__name

// Pages raise Nuxt errors with 4xx status codes on purpose (not found, hidden routes); they are not faults.
const isExpectedClientStatus = (error: unknown) => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  return typeof status === 'number' && status >= 400 && status < 500
}

export default defineNuxtPlugin({
  name: 'slax:client-error-log',
  enforce: 'pre',
  setup(nuxtApp) {
    // Error capture is diagnostics only; failing to set it up must not stop the app from starting.
    let collector: ReturnType<typeof useClientErrorLog>
    try {
      collector = useClientErrorLog()
      if (!collector.enabled) return
      installGlobalErrorCapture(collector, window)
    } catch {
      return
    }
    // Hooks keep Nuxt's own error handler and error page in charge of rendering.
    // A fatal component error reaches `vue:error` and then `app:error` wrapped by Nuxt's createError.
    const seenComponentErrors = new WeakSet<object>()
    // A thrown primitive (`throw 'boom'`) cannot go in the WeakSet, so the latest one is kept by value
    // until Nuxt reports it again through `app:error`, wrapped with it as `cause`.
    let lastComponentPrimitive: { value: unknown } | undefined
    const isSeen = (value: unknown) =>
      value !== null && value !== undefined && (typeof value === 'object' ? seenComponentErrors.has(value) : lastComponentPrimitive !== undefined && Object.is(lastComponentPrimitive.value, value))
    // Nuxt awaits these hooks inside its own error handling, so a throw here must not escape.
    nuxtApp.hook('vue:error', (error, instance, info) => {
      try {
        if (isExpectedClientStatus(error)) return
        if (error && typeof error === 'object') seenComponentErrors.add(error)
        else lastComponentPrimitive = { value: error }
        collector.capture('vue', error, { source: 'vue', info, component: componentName(instance) })
      } catch {
        // Diagnostics must not affect error handling.
      }
    })
    nuxtApp.hook('app:error', error => {
      try {
        if (isExpectedClientStatus(error)) return
        const cause = (error as { cause?: unknown } | null)?.cause
        if (isSeen(error) || isSeen(cause)) {
          lastComponentPrimitive = undefined
          return
        }
        collector.capture('vue', error, { source: 'app', status_code: (error as { statusCode?: number } | null)?.statusCode })
      } catch {
        // Diagnostics must not affect error handling.
      }
    })
  }
})
