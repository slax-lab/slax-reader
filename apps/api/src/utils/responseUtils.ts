import type { ApiResponse } from '@slax-reader/contracts'
import { corsCacheHeader, corsHeader, corsNotCacheHeader } from '../middleware/cors'
import { MultiLangError } from './multiLangError'

type ResponseType = 'json' | 'html'

interface ResponseOptions {
  data: any
  message?: string
  status?: number
  headers?: Record<string, string>
}

const defaultHeaders = {
  json: { 'Content-Type': 'application/json', ...corsHeader },
  html: { 'Content-Type': 'text/html' }
}

export const createResponse = (type: ResponseType, options: ResponseOptions): Response => {
  let { data, status = 200, headers = defaultHeaders[type], message = '' } = options
  if (data instanceof MultiLangError) {
    const mErr = data as MultiLangError
    message = mErr.getMessage
    status = mErr.errCode
    data = mErr.name
  }
  if ([401, 418, 429].includes(status)) {
    options.status = status
  }
  switch (type) {
    case 'json':
      return new Response(JSON.stringify({ data: data, message: message, code: status } satisfies ApiResponse), { status: options.status, headers })
    case 'html':
      return new Response(data, { status, headers })
    default:
      throw new Error('Unsupported response type')
  }
}

export const responseRedirect = (url: string, status = 302): Response => {
  return new Response(null, {
    status,
    headers: {
      Location: url,
      ...corsCacheHeader
    }
  })
}

export const isSafeImageMime = (mime: string): boolean => /^image\/(jpeg|png|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i.test(mime.split(';')[0].trim())

export const isSafeMediaMime = (mime: string): boolean => isSafeImageMime(mime) || /^video\/(mp4|webm|ogg)$/i.test(mime.split(';')[0].trim())

export const responseImage = (r: BodyInit, mime: string, cache = false, status = 200, mediaHeaders?: Headers): Response => {
  if (!isSafeMediaMime(mime)) {
    if (r instanceof ReadableStream) void r.cancel().catch(() => {})
    return new Response(null, { status: 415 })
  }
  const headers = new Headers({
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    ...(cache && status === 200 ? corsCacheHeader : corsNotCacheHeader)
  })
  for (const name of ['Content-Length', 'Accept-Ranges']) {
    const value = mediaHeaders?.get(name)
    if (value) headers.set(name, value)
  }
  const contentRange = mediaHeaders?.get('Content-Range')
  if (status === 206 && contentRange) headers.set('Content-Range', contentRange)
  return new Response(r, { status, headers })
}

const Successed = (data?: any, code = 200, message = 'ok', headers?: Record<string, string>) => createResponse('json', { data, status: code, message: message, headers })
const Failed = (data: any, code = 400, message = '', headers?: Record<string, string>) => createResponse('json', { data, status: code, message: message, headers })
const Panic = (data: any, code = 500, message = '', headers?: Record<string, string>) => createResponse('json', { data, status: code, message: message, headers })
const Render = (html: string, code = 200, headers?: Record<string, string>) => createResponse('html', { data: html, status: code, headers })
const RenderNotModify = (html: string, headers?: Record<string, string>) => createResponse('html', { data: html, status: 304, headers })
const NotFound = (data: any, message = '', headers?: Record<string, string>) => createResponse('json', { data, status: 404, message: message, headers })

export { Successed, Failed, Panic, Render, RenderNotModify, NotFound }
