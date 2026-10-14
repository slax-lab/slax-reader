import { getApiKey, getApiBase } from './config.js'

export function track(version: string): void {
  const apiKey = getApiKey()
  if (!apiKey) return

  const base = getApiBase()

  fetch(`${base}/m`, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey,
      'X-ACTION-TYPE': 'heartbeat',
      'X-CLIENT-TYPE': 'cli',
      'X-CLIENT-VERSION': version,
    },
    signal: AbortSignal.timeout(5000),
  }).catch(() => {})
}
