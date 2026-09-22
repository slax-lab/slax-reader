import { describe, expect, test } from 'vitest'
import { deploymentOrigin } from '@/utils/deploymentOrigin'
import { URLPolicie, parserType } from '@/utils/urlPolicie'
import { applyApiResponseHeaders, cors, isValidReferer } from '@/middleware/cors'

describe('operator frontend origins', () => {
  const front = 'https://reader.example.com'
  test.each(['https://reader.example.com.evil.test', 'https://evil.test', 'http://reader.example.com', 'https://reader.example.com:8443'])(
    'never grants credentialed CORS or image access to %s',
    async origin => {
      const req = new Request('https://api.example.com/events', { method: 'OPTIONS', headers: { Origin: origin } })
      const preflight = await cors(req, { env: { FRONT_END_URL: front } } as any)
      const error = applyApiResponseHeaders(new Response(null, { status: 401 }), req, front)
      for (const response of [preflight!, error]) expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
      expect(isValidReferer(origin + '/article', front)).toBe(false)
    }
  )
  test('configured origin has consistent credentialed preflight/error headers and image access', async () => {
    const req = new Request('https://api.example.com/events', { method: 'OPTIONS', headers: { Origin: front } })
    const preflight = await cors(req, { env: { FRONT_END_URL: front } } as any)
    const error = applyApiResponseHeaders(new Response(null, { status: 401 }), req, front)
    for (const response of [preflight!, error]) {
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(front)
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
      expect(response.headers.get('Vary')).toContain('Origin')
    }
    expect(isValidReferer(front + '/article', front)).toBe(true)
  })
  test.each(['garbage', 'javascript:alert(1)', 'https://name:password@reader.example.com', 'https://reader.example.com?secret=1'])(
    'ignores invalid configured origin %s',
    value => {
      expect(deploymentOrigin(value)).toBeUndefined()
    }
  )
  test.each(['prod', 'development'])('custom shares keep shortcut semantics in %s', RUN_ENV => {
    const env = { RUN_ENV, FRONT_END_URL: front } as Env
    expect(new URLPolicie(env, front + '/s/Abc123?source=share').getParserType()).toBe(parserType.URL_SHORTCUT)
    expect(new URLPolicie(env, front + '.evil.test/s/Abc123').isUrlShortcut()).toBe(false)
    expect(new URLPolicie(env, front + '/article').getParserType()).toBe(RUN_ENV === 'prod' ? parserType.BLOCK_PARSE : parserType.CLIENT_PARSE)
  })
})
