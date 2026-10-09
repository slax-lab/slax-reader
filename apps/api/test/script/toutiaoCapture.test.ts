import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const files = vi.hoisted(() => ({ mkdir: vi.fn().mockResolvedValue(undefined), writeFile: vi.fn().mockResolvedValue(undefined) }))
vi.mock('node:fs/promises', () => ({ default: files }))

import { runToutiaoCapture } from '../../script/toutiao-capture'
import { ROOT } from '../../script/root'

const id = '7694114872820384290'
const url = `https://www.toutiao.com/article/${id}/`

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('standalone capture', () => {
  test.each([[], ['unsupported'], [url, '--other'], [url, '--output'], [url, '--output', 'sample', 'extra']])(
    'fails safely for missing credentials or invalid arguments',
    async args => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      await expect(runToutiaoCapture(args, '')).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
      expect(files.writeFile).not.toHaveBeenCalled()
    }
  )

  test.each([undefined, '.local/toutiao-capture/custom'])('writes normalized artifacts relative to the root (output %s)', async directory => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ code: 200, data: { message: 'success', data: { content: '<p>A readable body.</p>', h5_extra: { title: 'Test title', name: 'Test author' } } } })
          )
        )
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runToutiaoCapture(directory ? [url, '--output', directory] : [url], 'secret-token')
    const output = path.join(ROOT, directory ?? `.local/toutiao-capture/${id}`)
    expect(files.mkdir).toHaveBeenCalledWith(output, { recursive: true })
    expect(files.writeFile.mock.calls.map(call => path.basename(call[0]))).toEqual(['capture.json', 'article.html', 'article.txt'])
    expect(JSON.parse(files.writeFile.mock.calls[0][1])).toMatchObject({ articleId: id, canonicalUrl: url, title: 'Test title', author: 'Test author' })
    expect(files.writeFile.mock.calls[1][1]).toContain('<p>A readable body.</p>')
    expect(files.writeFile.mock.calls[2][1]).toBe('A readable body.\n')
    expect(JSON.stringify(files.writeFile.mock.calls)).not.toContain('secret-token')
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`Canonical URL: ${url}`))
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token')
  })
})
