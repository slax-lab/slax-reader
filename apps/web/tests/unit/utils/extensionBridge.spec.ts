import { notifyExtensionBridgeAuthExpired } from '~~/app/utils/extensionBridge'

import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('extension bridge auth', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/x/ext-bridge')
  })

  it('notifies the offscreen parent when the same-origin session expires', () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined)
    notifyExtensionBridgeAuthExpired()
    expect(postMessage).toHaveBeenCalledWith({ type: 'slax-bridge-auth-expired' }, '*')
  })
})
