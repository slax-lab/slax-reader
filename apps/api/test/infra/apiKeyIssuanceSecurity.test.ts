import { describe, expect, test, vi } from 'vitest'
import { ApiKeyRepo } from '@/infra/repository/dbApiKey'

describe('API key issuance and deletion serialization', () => {
  test('does not issue credentials when the locked owner is missing or deleted', async () => {
    const upsert = vi.fn()
    const query = vi.fn().mockResolvedValue([])
    const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: query, sr_user_api_key: { upsert } }))
    const repo = new ApiKeyRepo(() => ({ $transaction: transaction }) as never)
    await expect(repo.upsertApiKey({ userId: 1, keyHash: 'hash', keyPrefix: 'sr-test', name: 'test' })).rejects.toThrow('inactive user')
    expect(upsert).not.toHaveBeenCalled()
    expect(query.mock.calls[0][0].join('?')).toContain('deleted_at IS NULL FOR UPDATE')
  })

  test('uses the same transaction for the owner lock and key write', async () => {
    const record = { id: 1, uuid: 'uuid', user_id: 1, key_prefix: 'sr-test', key_hash: 'hash', name: 'test', created_at: new Date(), updated_at: new Date() }
    const upsert = vi.fn().mockResolvedValue(record)
    const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: vi.fn().mockResolvedValue([{ id: 1 }]), sr_user_api_key: { upsert } }))
    const repo = new ApiKeyRepo(() => ({ $transaction: transaction }) as never)
    await expect(repo.upsertApiKey({ userId: 1, keyHash: 'hash', keyPrefix: 'sr-test', name: 'test' })).resolves.toMatchObject({ id: 1, userId: 1 })
    expect(transaction).toHaveBeenCalledOnce()
    expect(upsert).toHaveBeenCalledOnce()
  })
})
