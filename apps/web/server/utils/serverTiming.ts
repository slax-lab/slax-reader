import type { H3Event } from 'h3'

export function isServerTimingEnabled(event: H3Event): boolean {
  return String(useRuntimeConfig(event).public.slaxEnv) !== 'production'
}
