import { expect, test } from 'vitest'
import { HTTPRequest } from '@cloudflare/puppeteer/internal/api/HTTPRequest.js'

test('installed Cloudflare Puppeteer encodes the conservative 512 KiB resource ceiling', () => {
  const body = new Uint8Array(512 * 1024).fill(255)
  const response = HTTPRequest.getResponse(body)
  expect(response.contentLength).toBe(body.byteLength)
  expect(response.base64.length).toBe(4 * Math.ceil(body.byteLength / 3))
  expect(Buffer.from(response.base64, 'base64')).toEqual(Buffer.from(body))
})
