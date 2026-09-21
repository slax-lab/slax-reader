import { bookmarkExportFilename, exportCsvCell, prepareBookmarkExport } from '~~/app/utils/bookmarkExport'

import type { BookmarkExportItem } from '@commons/types/interface'
import { describe, expect, it, vi } from 'vitest'

const item: BookmarkExportItem = {
  url: 'https://example.com/a,b',
  title: '=SUM(1,2)\n"中文"',
  tags: [
    { name: 'tag,"中文"', source: 'ai' },
    { name: 'line\nbreak', source: 'user' }
  ],
  saved_at: '2026-09-08T00:00:00.000Z',
  is_read: false,
  is_archived: true,
  is_starred: false,
  type: 'shortcut'
}
const options = () => ({ signal: new AbortController().signal, onProgress: vi.fn(), now: new Date('2026-09-08T00:00:00Z') })

describe('saved-link export', () => {
  it('preserves exact JSON text, sources and independent states', async () => {
    const result = await prepareBookmarkExport({ ...options(), format: 'json', fetchPage: async () => ({ items: [item], next_cursor: null }) })
    expect(JSON.parse(await result.blob!.text())).toEqual({ schema_version: 1, exported_at: '2026-09-08T00:00:00.000Z', items: [item] })
  })
  it('writes CSV BOM, fixed headers, quoted JSON tags and spreadsheet-safe text', async () => {
    const result = await prepareBookmarkExport({ ...options(), format: 'csv', fetchPage: async () => ({ items: [item], next_cursor: null }) })
    expect(Array.from(new Uint8Array(await result.blob!.arrayBuffer()).slice(0, 3))).toEqual([239, 187, 191])
    const csv = await result.blob!.text()
    expect(csv).toContain('url,title,tags,saved_at,is_read,is_archived,is_starred,type\r\n')
    expect(csv).toContain(exportCsvCell(item.title))
    expect(csv).toContain(exportCsvCell(JSON.stringify(item.tags.map(tag => tag.name))))
    for (const value of ['=1+1', '+1', '-1', '@cmd', '  =1', '\tfoo', '\rfoo', '\nfoo']) expect(exportCsvCell(value)).toMatch(/^"'/)
    expect(exportCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"')
    expect(bookmarkExportFilename('csv', new Date(2026, 8, 8, 0, 1))).toBe('slax-reader-links-20260908.csv')
  })
  it('returns no file for an empty account', async () => {
    expect(await prepareBookmarkExport({ ...options(), format: 'csv', fetchPage: async () => ({ items: [], next_cursor: null }) })).toEqual({ count: 0, blob: null })
  })
  it('fetches sequential pages including an empty page after deletions', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [item], next_cursor: 'opaque' })
      .mockResolvedValueOnce({ items: [], next_cursor: 'last' })
      .mockResolvedValueOnce({ items: [item], next_cursor: null })
    const opts = options()
    const result = await prepareBookmarkExport({ ...opts, format: 'json', fetchPage })
    expect(fetchPage.mock.calls.map(call => call[0])).toEqual([undefined, 'opaque', 'last'])
    expect(opts.onProgress.mock.calls).toEqual([[1], [2]])
    expect(JSON.parse(await result.blob!.text()).items).toHaveLength(2)
  })
  it('rejects page errors or expired sessions without a file, and retry starts fresh', async () => {
    for (const failure of [undefined, new Error('401')]) {
      const fetchPage = vi.fn().mockResolvedValueOnce({ items: [item], next_cursor: 'next' })
      if (failure) fetchPage.mockRejectedValueOnce(failure)
      else fetchPage.mockResolvedValueOnce(undefined)
      await expect(prepareBookmarkExport({ ...options(), format: 'json', fetchPage })).rejects.toThrow()
      fetchPage.mockResolvedValueOnce({ items: [item], next_cursor: null })
      expect((await prepareBookmarkExport({ ...options(), format: 'json', fetchPage })).count).toBe(1)
      expect(fetchPage.mock.calls[2]![0]).toBeUndefined()
    }
  })
  it('ignores a late response after cancellation', async () => {
    const controller = new AbortController()
    const onProgress = vi.fn()
    await expect(
      prepareBookmarkExport({
        signal: controller.signal,
        format: 'csv',
        onProgress,
        fetchPage: async (_cursor, signal) => {
          controller.abort()
          expect(signal.aborted).toBe(true)
          return { items: [item], next_cursor: null }
        }
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(onProgress).not.toHaveBeenCalled()
  })
  it('yields for cancellation between pages', async () => {
    const controller = new AbortController()
    const fetchPage = vi.fn(async () => ({ items: [item], next_cursor: 'next' }))
    await expect(prepareBookmarkExport({ signal: controller.signal, format: 'json', fetchPage, onProgress: () => setTimeout(() => controller.abort(), 0) })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
  it('rejects repeated cursors', async () => {
    await expect(prepareBookmarkExport({ ...options(), format: 'json', fetchPage: async () => ({ items: [item], next_cursor: 'same' }) })).rejects.toThrow('Repeated export cursor')
  })
  it.each(['csv', 'json'] as const)(
    'exports all 100,000 synthetic records as %s',
    async format => {
      let pageCount = 0
      const result = await prepareBookmarkExport({
        ...options(),
        format,
        fetchPage: async cursor => {
          const offset = Number(cursor || 0)
          pageCount++
          return {
            items: Array.from({ length: 500 }, (_, i) => ({ ...item, url: `https://example.com/${offset + i}`, title: `Item ${offset + i}` })),
            next_cursor: offset + 500 < 100000 ? String(offset + 500) : null
          }
        }
      })
      expect(result.count).toBe(100000)
      expect(pageCount).toBe(200)
      const text = await result.blob!.text()
      if (format === 'json') {
        const items = JSON.parse(text).items as BookmarkExportItem[]
        expect(items).toHaveLength(100000)
        expect(new Set(items.map(record => record.url)).size).toBe(100000)
      } else expect(text.match(/https:\/\/example.com\/\d+/g)).toHaveLength(100000)
      expect(text).toContain('https://example.com/99999')
    },
    20000
  )
})

describe('export request transport', () => {
  it('keeps session authorization and the abort signal through async interceptors', async () => {
    const { FetchRequest } = await import('@commons/utils/request')
    const controller = new AbortController()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 200, data: { items: [item], next_cursor: null } }), { status: 200 }))
    const client = new FetchRequest({
      baseUrl: 'https://api.example.com',
      requestInterceptors: async options => ({ ...options, headers: { Authorization: 'Bearer session-test' } }),
      responseInterceptors: async response => response
    })
    try {
      const page = await client.get({ url: '/v1/bookmark/export', signal: controller.signal })
      expect(page).toEqual({ items: [item], next_cursor: null })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/v1/bookmark/export',
        expect.objectContaining({ signal: controller.signal, headers: expect.objectContaining({ Authorization: 'Bearer session-test' }) })
      )
    } finally {
      fetchMock.mockRestore()
    }
  })
  it('aborts an in-flight HTTP request and propagates session expiry', async () => {
    const { FetchRequest } = await import('@commons/utils/request')
    const controller = new AbortController()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          controller.abort()
        })
    )
    const expired = vi.fn()
    const client = new FetchRequest({
      baseUrl: 'https://api.example.com',
      responseInterceptors: async response => {
        if (response.status === 401) expired()
        return response
      }
    })
    try {
      await expect(client.get({ url: '/v1/bookmark/export', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
      expect(await client.get({ url: '/v1/bookmark/export' })).toBe('')
      expect(expired).toHaveBeenCalledTimes(1)
    } finally {
      fetchMock.mockRestore()
    }
  })
})
