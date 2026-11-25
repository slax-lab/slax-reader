/**
 * Applies every committed logs migration to in-memory PostgreSQL (PGlite) and
 * writes through the real LogsService/LogsRepo SQL. LogsService.track swallows
 * failures, so the rows are read back instead of relying on an exception.
 */
import { PGlite } from '@electric-sql/pglite'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { LogsService } from '@/domain/logs'
import { LogsRepo } from '@/infra/repository/dbLogs'

const logsMigrationsRoot = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'prisma/logs_migrations')

let db: PGlite
let logs: LogsService

beforeAll(async () => {
  db = new PGlite()
  const dirs = (await readdir(logsMigrationsRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort()
  for (const dir of dirs) await db.exec(await readFile(path.join(logsMigrationsRoot, dir, 'migration.sql'), 'utf8'))
  logs = new LogsService(
    new LogsRepo((() => ({
      // Translates Prisma's tagged template into PGlite parameters; the SQL stays dbLogs.ts's own text.
      $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) =>
        db.query(
          strings.reduce((sql, part, index) => sql + part + (index < values.length ? `$${index + 1}` : ''), ''),
          values
        )
    })) as never)
  )
})

afterAll(async () => {
  await db?.close()
})

const rows = async (operationKey: string) =>
  (
    await db.query<{ user_id: number; event_name: string; extra_data: Record<string, unknown> }>(
      `SELECT user_id, event_name::text AS event_name, extra_data
       FROM user_logs
       WHERE extra_data->>'operation_key' = $1
       ORDER BY id`,
      [operationKey]
    )
  ).rows

describe('Subscription lifecycle telemetry event kinds', () => {
  test('auto_renew_off, cancel and refund are accepted by event_kind', async () => {
    const operationKey = 'telemetry:test:lifecycle'
    const extra = { status: 'success', source: 'stripe', subscription_type: 'initial_subscription' }

    await logs.track(7, 'auto_renew_off', { ...extra, operation_key: operationKey })
    await logs.track(7, 'cancel', { ...extra, operation_key: operationKey })
    await logs.track(7, 'refund', { ...extra, operation_key: operationKey })

    const found = await rows(operationKey)
    // A missing enum value yields zero rows without an error.
    expect(found.map(row => row.event_name)).toEqual(['auto_renew_off', 'cancel', 'refund'])
    expect(found.every(row => row.user_id === 7)).toBe(true)
    expect(found.every(row => row.extra_data.status === 'success')).toBe(true)
  })

  test('unregistered event names are still dropped silently', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const operationKey = 'telemetry:test:unregistered'
      await expect(logs.track(7, 'not_a_registered_event', { operation_key: operationKey })).resolves.toBeUndefined()
      expect(await rows(operationKey)).toHaveLength(0)
    } finally {
      error.mockRestore()
    }
  })
})
