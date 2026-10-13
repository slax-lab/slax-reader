import { setExtensionLocale } from '../src/utils/locale'

import { BrowserService } from '../src/entrypoints/background/browserService'
import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => vi.unstubAllGlobals())
it('creates fixed menu ids once then updates their language without duplication', async () => {
  const titles = new Map<string, string>()
  const update = vi.fn(async (id: string, options: { title: string }) => {
    if (!titles.has(id)) throw new Error('missing')
    titles.set(id, options.title)
  })
  const create = vi.fn((options: { id: string; title: string }, callback: () => void) => {
    titles.set(options.id, options.title)
    callback?.()
    return options.id
  })
  vi.stubGlobal('browser', { contextMenus: { update, create }, runtime: {} })
  setExtensionLocale('en')
  await BrowserService.registerContextMenus()
  const en = titles.get('collect')
  setExtensionLocale('zh')
  await BrowserService.updateContextMenuLocale()
  expect(titles.size).toBe(2)
  expect(create).toHaveBeenCalledTimes(2)
  expect(titles.get('collect')).not.toBe(en)
})
