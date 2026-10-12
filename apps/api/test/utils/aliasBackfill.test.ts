import { describe, expect, test } from 'vitest'
import { aliasBackfillQuery, aliasBackfillSql } from '../../script/backfill-user-device-alias'

describe('D1 alias backfill export', () => {
  test('keeps earliest source timestamp and ignores existing immutable bindings', () => {
    expect(aliasBackfillQuery).toContain('MIN(event_time)')
    const sql = aliasBackfillSql([{ user_id: 7, device_id: 'device-1', bound_at: '2026-09-01T00:00:00Z' }])
    expect(sql).toContain('INSERT OR IGNORE')
    expect(sql).toContain("'2026-09-01T00:00:00.000Z', 'backfill'")
    expect(sql).not.toContain('UPDATE')
  })
  test('device values cannot escape the SQL string literal', () => {
    expect(aliasBackfillSql([{ user_id: 7, device_id: "device'one", bound_at: new Date(0) }])).toContain("'device''one'")
  })
  test('rejects invalid IDs and timestamps rather than generating corrupt bindings', () => {
    expect(() => aliasBackfillSql([{ user_id: 0, device_id: 'device', bound_at: new Date() }])).toThrow('Invalid alias')
    expect(() => aliasBackfillSql([{ user_id: 7, device_id: 'device', bound_at: 'invalid' }])).toThrow('Invalid binding time')
  })
})
