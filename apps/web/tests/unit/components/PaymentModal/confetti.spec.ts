import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// canvas-confetti is globally mocked in tests/setup/fork.ts
// We just need to verify the exported functions call confetti without throwing

describe('confetti.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('star() calls confetti without throwing', async () => {
    const { star } = await import('~~/app/components/PaymentModal/confetti.ts')
    expect(() => star(1000)).not.toThrow()
    vi.advanceTimersByTime(1100)
  })

  it('fireworks() calls confetti without throwing', async () => {
    const { fireworks } = await import('~~/app/components/PaymentModal/confetti.ts')
    expect(() => fireworks(1000)).not.toThrow()
    vi.advanceTimersByTime(1100)
  })

  it('pride() calls confetti without throwing', async () => {
    const { pride } = await import('~~/app/components/PaymentModal/confetti.ts')
    expect(() => pride(1000)).not.toThrow()
    vi.advanceTimersByTime(300) // past the 250ms setTimeout
  })

  it('all three functions are exported', async () => {
    const mod = await import('~~/app/components/PaymentModal/confetti.ts')
    expect(typeof mod.star).toBe('function')
    expect(typeof mod.fireworks).toBe('function')
    expect(typeof mod.pride).toBe('function')
  })
})
