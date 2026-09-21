import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { modalBootloaderMock } = vi.hoisted(() => ({
  modalBootloaderMock: vi.fn(() => ({
    unmount: vi.fn(),
    _container: { remove: vi.fn() }
  }))
}))
mockNuxtImport('modalBootloader', () => modalBootloaderMock)

describe('PaymentModal/index.ts', () => {
  beforeEach(() => modalBootloaderMock.mockClear())

  it('showPaymentModal calls modalBootloader with correct props', async () => {
    const { showPaymentModal } = await import('~~/app/components/PaymentModal/index.ts')
    showPaymentModal({ type: 'sub', priceId: 'price_123' })
    expect(modalBootloaderMock).toHaveBeenCalledTimes(1)
    const call = modalBootloaderMock.mock.calls[0]!
    expect(call[0].props).toMatchObject({ type: 'sub', priceId: 'price_123' })
  })

  it('showPaymentModal onDismiss calls completeHandler, unmounts, and removes container', async () => {
    const { showPaymentModal } = await import('~~/app/components/PaymentModal/index.ts')
    const handler = vi.fn()
    showPaymentModal({ type: 'sub', priceId: 'price_123' }, handler)
    const appInstance = modalBootloaderMock.mock.results[0]!.value
    const { onDismiss } = modalBootloaderMock.mock.calls[0]![0].props
    onDismiss(true)
    expect(handler).toHaveBeenCalledWith(true)
    expect(appInstance.unmount).toHaveBeenCalled()
    expect(appInstance._container.remove).toHaveBeenCalled()
  })

  it('showRedeemModal calls modalBootloader', async () => {
    const { showRedeemModal } = await import('~~/app/components/PaymentModal/index.ts')
    showRedeemModal()
    expect(modalBootloaderMock).toHaveBeenCalledTimes(1)
  })

  it('showRedeemModal onDismiss calls completeHandler and cleans up', async () => {
    const { showRedeemModal } = await import('~~/app/components/PaymentModal/index.ts')
    const handler = vi.fn()
    showRedeemModal(handler)
    const appInstance = modalBootloaderMock.mock.results[0]!.value
    const { onDismiss } = modalBootloaderMock.mock.calls[0]![0].props
    onDismiss(false)
    expect(handler).toHaveBeenCalledWith(false)
    expect(appInstance.unmount).toHaveBeenCalled()
    expect(appInstance._container.remove).toHaveBeenCalled()
  })
})
