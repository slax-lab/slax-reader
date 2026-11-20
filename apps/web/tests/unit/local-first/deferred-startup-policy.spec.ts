import { isDeferredLocalStartupPath, needsLocalStartupDocumentExit } from '~/local-first/deferred-startup-policy'
import { describe, expect, it } from 'vitest'

describe('deferred local startup policy', () => {
  it.each(['/b/abc', '/b/abc/', '/user', '/user/', '/collection/manage', '/collection/manage/'])('defers %s', path => {
    expect(isDeferredLocalStartupPath(path)).toBe(true)
    expect(needsLocalStartupDocumentExit(path)).toBe(false)
  })

  it.each(['/', '/bookmarks', '/bookmarks/12', '/b', '/b/', '/b/abc/extra', '/x/ext-bridge', '/s/abc', '/c/abc', '/users', '/collection', '/login'])('keeps normal startup for %s', path => {
    expect(isDeferredLocalStartupPath(path)).toBe(false)
    expect(needsLocalStartupDocumentExit(path)).toBe(true)
  })
})
