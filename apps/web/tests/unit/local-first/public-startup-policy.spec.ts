import { describe, expect, it } from 'vitest'
import { isFastPublicPath, needsPublicDocumentExit, shouldBypassPublicDatabase } from '~/local-first/public-startup-policy'
describe('public startup policy', () => {
  it.each(['/login', '/login/', '/guide', '/guide/'])('allows exact public path %s', path => expect(isFastPublicPath(path)).toBe(true))
  it.each(['/login/foo', '/guide/foo', '/?next=/login', '/auth', '/bookmarks'])('rejects lookalike path %s', path => expect(isFastPublicPath(path)).toBe(false))
  it('bypasses only enabled top-level anonymous exact paths', () => {
    expect(shouldBypassPublicDatabase({ enabled: true, pathname: '/guide', topLevel: true, tokenState: 'absent' })).toBe(true)
    expect(shouldBypassPublicDatabase({ enabled: false, pathname: '/guide', topLevel: true, tokenState: 'absent' })).toBe(false)
    expect(shouldBypassPublicDatabase({ enabled: true, pathname: '/guide', topLevel: false, tokenState: 'absent' })).toBe(false)
    expect(shouldBypassPublicDatabase({ enabled: true, pathname: '/guide', topLevel: true, tokenState: 'present' })).toBe(false)
    expect(shouldBypassPublicDatabase({ enabled: true, pathname: '/guide', topLevel: true, tokenState: 'error' })).toBe(false)
  })
  it('requires document exit only for destinations outside public allowlist', () => {
    expect(needsPublicDocumentExit(true, '/bookmarks')).toBe(true)
    expect(needsPublicDocumentExit(true, '/guide/')).toBe(false)
    expect(needsPublicDocumentExit(false, '/bookmarks')).toBe(false)
  })
})
