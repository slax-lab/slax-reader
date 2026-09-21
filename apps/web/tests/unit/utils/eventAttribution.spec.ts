// @vitest-environment happy-dom
import { consumeEventEntry, eventEntryUrl } from '../../../app/utils/eventAttribution'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const allowed = ['bookmarks', 'inbox_collection', 'search_result', 'direct'] as const
let page: { location: { href: string }; history: { state: unknown; replaceState: ReturnType<typeof vi.fn> } }

beforeEach(() => {
  page = {
    location: { href: 'https://reader.test/b/bookmark-1' },
    history: {
      state: {},
      replaceState: vi.fn((_state, _title, path) => {
        page.location.href = new URL(path, 'https://reader.test').href
      })
    }
  }
  vi.stubGlobal('window', page)
})
afterEach(() => vi.unstubAllGlobals())

describe('one-use reader entry attribution', () => {
  it.each(['bookmarks', 'inbox_collection', 'search_result'] as const)('preserves %s across a new-tab URL and clears it before refresh', source => {
    page.location.href = `https://reader.test${eventEntryUrl('/b/bookmark-1?highlight=12#text', source)}`
    expect(consumeEventEntry(allowed, 'direct')).toBe(source)
    expect(page.location.href).toBe('https://reader.test/b/bookmark-1?highlight=12#text')
    expect(consumeEventEntry(allowed, 'direct')).toBe('direct')
  })

  it('unknown or external entry hints cannot introduce unregistered enum values', () => {
    page.location.href += '?_slax_entry=unregistered'
    expect(consumeEventEntry(allowed, 'direct')).toBe('direct')
    expect(page.location.href).toBe('https://reader.test/b/bookmark-1')
  })

  it('collection inbox entry has a separate enum', () => {
    page.location.href = `https://reader.test${eventEntryUrl('/c/collection-1', 'inbox')}`
    expect(consumeEventEntry(['external_link', 'inbox'] as const, 'external_link')).toBe('inbox')
  })
})
