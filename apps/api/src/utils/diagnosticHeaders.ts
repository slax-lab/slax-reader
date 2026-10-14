const SERVER_TIMING_HEADER = 'Server-Timing'

export function serverTimingEnabled(env: Env): boolean {
  return env.RUN_TYPE !== 'prod'
}

function normalizeMetricPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
}

export function elapsedMs(startedAt: number): number {
  return performance.now() - startedAt
}

export function appendTiming(headers: Headers, scope: string, step: string, durationMs: number): void {
  const metric = `${normalizeMetricPart(scope)}_${normalizeMetricPart(step)};dur=${Math.max(0, durationMs).toFixed(1)}`
  const current = headers.get(SERVER_TIMING_HEADER)

  headers.set(SERVER_TIMING_HEADER, current ? `${current}, ${metric}` : metric)
}

export function copyResponse(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
