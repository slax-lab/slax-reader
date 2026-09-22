/**
 * Real Postgres through LabRepo / LabService: the compound key on upsert, the
 * "no row means off" read, and the YouTube seed rows from the migration.
 * Runs only with RUN_PG_INTEGRATION_TESTS=1 after migrations.
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { LabRepo } from '@/infra/repository/dbLab'
import { LabService } from '@/domain/lab'
import { ErrorName } from '@/const/err'

const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

describePg('LabRepo on Postgres', () => {
  let pg: HyperdrivePrismaClient
  let repo: LabRepo
  let service: LabService
  let userId = 0
  const token = randomUUID().slice(0, 8)

  beforeAll(async () => {
    pg = new HyperdrivePrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.HYPERDRIVE_DATABASE_URL, max: 1 })) })
    repo = new (LabRepo as any)(() => pg) as LabRepo
    service = new (LabService as any)(repo) as LabService
    const user = await pg.sr_user.create({ data: { email: `labs-${token}@example.test`, last_login_at: new Date(), created_at: new Date() } })
    userId = user.id
  })

  afterAll(async () => {
    if (userId) {
      await pg.sr_user_lab_feature.deleteMany({ where: { user_id: userId } })
      await pg.sr_user.delete({ where: { id: userId } })
    }
    await pg.$disconnect()
  })

  test('no row means off; upsert flips one row per (user, feature)', async () => {
    expect(await repo.isEnabled(userId, 'youtube')).toBe(false)
    expect(await service.listForUser(userId)).toEqual([{ key: 'youtube', status: 'active', enabled: false, enabled_at: null }])

    await service.setEnabled(userId, 'youtube', true)
    expect(await repo.isEnabled(userId, 'youtube')).toBe(true)
    const [row] = await service.listForUser(userId)
    expect(row.enabled).toBe(true)
    expect(row.enabled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    await service.setEnabled(userId, 'youtube', false)
    await service.setEnabled(userId, 'youtube', false)
    expect(await repo.isEnabled(userId, 'youtube')).toBe(false)
    expect(await repo.listByUser(userId)).toHaveLength(1)
  })

  test('assertUrlAllowed reads the switch', async () => {
    const ctx = { getUserId: () => userId } as any
    const err = await service.assertUrlAllowed(ctx, 'https://youtu.be/dQw4w9WgXcQ').catch(e => e)
    expect(err.name).toBe(ErrorName.LAB_FEATURE_DISABLED)

    await service.setEnabled(userId, 'youtube', true)
    await expect(service.assertUrlAllowed(ctx, 'https://youtu.be/dQw4w9WgXcQ')).resolves.toBeUndefined()
  })
})
