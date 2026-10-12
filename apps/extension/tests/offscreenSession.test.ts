import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (message: unknown, sender: unknown, reply: (data: unknown) => void) => boolean
type Frame = { contentWindow: { postMessage: ReturnType<typeof vi.fn> }; remove: ReturnType<typeof vi.fn>; style: Record<string, string>; src: string }
let onRuntimeMessage: Listener
let onWindowMessage: (event: { data: unknown; origin: string; source: unknown }) => void
let frames: Frame[]
const sendMessage = vi.fn()
const origin = 'https://reader.test'

const command = (method: string) => {
  const reply = vi.fn()
  onRuntimeMessage({ target: 'slax-offscreen', method }, {}, reply)
  return reply
}
const requestSession = (frame: Frame, from = origin, source: unknown = frame.contentWindow) => {
  onWindowMessage({ origin: from, source, data: { type: 'slax-bridge-session-request', requestId: 'session-1' } })
}
const sessionCalls = () => sendMessage.mock.calls.filter(([msg]) => msg.method === 'bridge-session')
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  frames = []
  sendMessage.mockReset().mockResolvedValue({ success: true, token: 'current-token' })
  vi.stubEnv('PUBLIC_BASE_URL', origin)
  vi.stubGlobal('chrome', {
    runtime: { id: 'allowed-extension', sendMessage, onMessage: { addListener: (callback: Listener) => { onRuntimeMessage = callback } } }
  })
  vi.stubGlobal('window', { addEventListener: (_: string, listener: typeof onWindowMessage) => { onWindowMessage = listener } })
  vi.stubGlobal('document', {
    createElement: () => {
      const frame: Frame = { contentWindow: { postMessage: vi.fn() }, remove: vi.fn(), style: {}, src: '' }
      frames.push(frame)
      return frame
    },
    body: { appendChild: vi.fn() }
  })
  await import('../src/entrypoints/offscreen/main')
  command('mount')
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('offscreen session relay', () => {
  it('uses the live background session and sends the token only to its web origin', async () => {
    requestSession(frames[0])
    await flush()
    expect(sessionCalls()).toHaveLength(1)
    expect(frames[0].contentWindow.postMessage).toHaveBeenCalledWith({
      type: 'slax-bridge-session-response', requestId: 'session-1', success: true, token: 'current-token'
    }, origin)
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain('current-token')
    expect(frames[0].src).not.toContain('current-token')
  })

  it('does not ask for credentials for other origins or frames', async () => {
    requestSession(frames[0], 'https://attacker.test')
    requestSession(frames[0], origin, {})
    await flush()
    expect(sessionCalls()).toHaveLength(0)
    expect(frames[0].contentWindow.postMessage).not.toHaveBeenCalled()
  })

  it('drops an in-flight credential response after the iframe has been replaced', async () => {
    let complete!: (response: unknown) => void
    sendMessage.mockImplementation(message => message.method === 'bridge-session'
      ? new Promise(resolve => { complete = resolve })
      : Promise.resolve())
    const oldFrame = frames[0]
    requestSession(oldFrame)
    command('unmount')
    command('mount')
    complete({ success: true, token: 'old-account-token' })
    await flush()
    expect(oldFrame.contentWindow.postMessage).not.toHaveBeenCalled()
    expect(frames[1].contentWindow.postMessage).not.toHaveBeenCalled()
    requestSession(oldFrame)
    expect(sessionCalls()).toHaveLength(1)
  })

  it('returns an empty session after logout and a bounded failure when the worker fails', async () => {
    sendMessage.mockResolvedValue({ success: true, token: null })
    requestSession(frames[0])
    await flush()
    expect(frames[0].contentWindow.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ success: true, token: null }), origin)
    sendMessage.mockImplementation(message => message.method === 'bridge-session' ? Promise.reject(new Error('worker unavailable')) : Promise.resolve())
    requestSession(frames[0])
    await flush()
    expect(frames[0].contentWindow.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ success: false, token: null }), origin)
  })
})
