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
    // Nuxt awaits these hooks inside its own error handling, so a throw here must not escape.
    nuxtApp.hook('vue:error', (error, instance, info) => {
      try {
        if (isExpectedClientStatus(error)) return
        if (error && typeof error === 'object') seenComponentErrors.add(error)
        collector.capture('vue', error, { source: 'vue', info, component: componentName(instance) })
      } catch {
        // Diagnostics must not affect error handling.
      }
    })
    nuxtApp.hook('app:error', error => {
      try {
        if (isExpectedClientStatus(error)) return
        const cause = (error as { cause?: unknown } | null)?.cause
        if ((error && seenComponentErrors.has(error)) || (cause && typeof cause === 'object' && seenComponentErrors.has(cause))) return
        collector.capture('vue', error, { source: 'app', status_code: (error as { statusCode?: number } | null)?.statusCode })
      } catch {
        // Diagnostics must not affect error handling.
      }
    })
  }
})
