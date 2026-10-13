import { notifyExtensionAccountLocaleInvalidated } from '~~/app/utils/extensionLocale'

import { expect, it, vi } from 'vitest'
it('announces invalidation without any account or language payload', () => {
  const send = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
  notifyExtensionAccountLocaleInvalidated()
  expect(send).toHaveBeenCalledWith({ type: 'slax-reader:account-locale-invalidated', version: 1 }, window.location.origin)
  send.mockRestore()
})
