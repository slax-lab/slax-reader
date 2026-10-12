import { beforeEach, expect, test, vi } from 'vitest'

const pg = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn() }))
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: any, public env: any) {} } }))
vi.mock('pg', () => ({ Client: class { query = pg.query; connect = pg.connect; end = pg.end } }))
import { SlaxWebSocketServer } from '@/infra/message/websocket'

beforeEach(() => {
  vi.clearAllMocks()
  pg.query.mockResolvedValue({ rows: [{ id: 42 }] })
  vi.stubGlobal('WebSocketRequestResponsePair', class {})
})
function socket(userId: number, uuid: string, connectType = 'web') {
  return { deserializeAttachment: () => ({ userId, uuid, connectType, deviceId: 1 }), send: vi.fn(), close: vi.fn() }
}
function server(sockets: any[]) {
  return new SlaxWebSocketServer({ getWebSockets: () => sockets, setWebSocketAutoResponse: vi.fn() } as any,
    { HYPERDRIVE: { connectionString: 'postgres://test' }, DB: { prepare: () => ({ bind: () => ({ run: vi.fn() }) }) } } as any)
}
test('already-connected sockets are rechecked before each push and revoked together', async () => {
  const web = socket(42, 'web')
  const extension = socket(42, 'extension', 'extensions')
  const other = socket(43, 'other')
  const doServer = server([web, extension, other])
  expect(await doServer.sendReminder('web', 1)).toBe(true)
  pg.query.mockResolvedValue({ rows: [] })
  expect(await doServer.sendReminder('web', 2)).toBe(false)
  expect(web.send).toHaveBeenCalledTimes(1)
  expect(web.close).toHaveBeenCalledWith(1008, 'Account unavailable')
  expect(extension.close).toHaveBeenCalledOnce()
  expect(other.close).not.toHaveBeenCalled()
  expect(pg.query.mock.calls[0][0]).toContain('CURRENT_TIMESTAMP')
})
test('database outage prevents extension pushes and closes stale sessions', async () => {
  const extension = socket(42, 'extension', 'extensions')
  const doServer = server([extension])
  pg.query.mockRejectedValue(new Error('DB unavailable'))
  await doServer.sendBookmarkChange({ user_id: 42, bookmark_id: 1, created_at: new Date(), target_url: 'https://example.com', action: 'add' })
  expect(extension.send).not.toHaveBeenCalled()
  expect(extension.close).toHaveBeenCalledOnce()
})
test('explicit revocation disconnects both kinds without depending on a PG read', async () => {
  const web = socket(42, 'web')
  const extension = socket(42, 'extension', 'extensions')
  await server([web, extension]).revokeUser(42)
  expect(web.close).toHaveBeenCalledOnce()
  expect(extension.close).toHaveBeenCalledOnce()
  expect(pg.query).not.toHaveBeenCalled()
})
