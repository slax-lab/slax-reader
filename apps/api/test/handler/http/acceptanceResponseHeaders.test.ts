import { describe, expect, test } from 'vitest'
import { applyApiResponseHeaders, cors } from '@/middleware/cors'
import { Failed } from '@/utils/responseUtils'
import { ErrorParam, UnauthorizedError } from '@/const/err'

describe('acceptance response contracts', () => {
  test.each(['https://r.slax.dev', 'https://r.slax.app', 'http://localhost:3000'])('credentialed events preflight and errors agree for %s', async origin => {
    const request = new Request('https://reader-api.slax.dev/events', { method: 'OPTIONS', headers: { Origin: origin } })
    const preflight = await cors(request, {} as any)
    const error = applyApiResponseHeaders(Failed(UnauthorizedError()), request)
    for (const response of [preflight!, error]) {
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
      expect(response.headers.get('Vary')).toContain('Origin')
    }
  })

  test.each(['https://r.slax.dev.evil.test', 'null', 'https://evil.test', 'https://www.qiaoqiaodaka.com'])('never grants credentials to %s', async origin => {
    const request = new Request('https://reader-api.slax.dev/events', { method: 'OPTIONS', headers: { Origin: origin } })
    const response = await cors(request, {} as any)
    expect(response!.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test.each([ErrorParam(), UnauthorizedError()])('export errors carry no-store and consistent status: %s', async error => {
    const response = applyApiResponseHeaders(Failed(error), new Request('https://reader-api.slax.dev/v1/bookmark/export?cursor=bad!'))
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.status).toBe(error.errCode)
    expect(await response.json()).toMatchObject({ code: error.errCode, data: error.name })
  })
})
