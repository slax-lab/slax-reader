import { EDGE_RAY_ID_HEADER } from '@/const/edge'

let instanceId: string | undefined
let metadataRequestNumber = 0

export class ContentTiming {
  private readonly startedAt = performance.now()
  private readonly identity: {
    scope: 'edge' | 'core'
    instance_id: string
    request_number: number
    ray_id: string | null
  }

  constructor(scope: 'edge' | 'core', request: Request) {
    // This counts observed metadata requests, not provider isolate invocations.
    this.identity = {
      scope,
      instance_id: (instanceId ??= crypto.randomUUID()),
      request_number: ++metadataRequestNumber,
      ray_id: request.headers.get(EDGE_RAY_ID_HEADER) ?? request.headers.get('CF-Ray')
    }
    console.info('content.timing', { ...this.identity, phase: 'entry' })
  }

  log(phases: Record<string, number>, statusCode?: number): void {
    console.info('content.timing', {
      ...this.identity,
      phase: 'response',
      outcome: statusCode === undefined ? 'failed' : 'returned',
      ...(statusCode === undefined ? {} : { status_code: statusCode }),
      total_ms: Math.round(performance.now() - this.startedAt),
      phases_ms: phases
    })
  }
}
