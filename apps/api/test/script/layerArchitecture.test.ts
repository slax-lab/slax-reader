import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  ALLOWED,
  analyzeSource,
  API_DIR,
  countViolations,
  LAYERS,
  layerOf,
  loadContext,
  sourceFiles,
  violationKey,
  type Context,
  type Layer,
  type Violation
} from '../helpers/layerRules'

const BASELINE = path.join(API_DIR, 'test/script/layerArchitecture.baseline.json')
const context = loadContext()
const files = sourceFiles()
const violations = files.flatMap(file => analyzeSource(file, fs.readFileSync(path.join(API_DIR, file), 'utf8'), context))
const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Record<string, number>
const describeViolation = (violation: Violation) => `${violation.file}:${violation.line} ${violation.rule} ${violation.detail}${violation.note ? ` (${violation.note})` : ''}`

describe('API layer rules', () => {
  test('the allowed dependencies form a strict hierarchy without cycles', () => {
    const visiting = new Set<Layer>()
    const done = new Set<Layer>()
    const cycle = (layer: Layer): boolean => {
      if (done.has(layer)) return false
      if (visiting.has(layer)) return true
      visiting.add(layer)
      const found = ALLOWED[layer].some(cycle)
      visiting.delete(layer)
      done.add(layer)
      return found
    }
    expect(LAYERS.filter(cycle)).toEqual([])
    for (const lower of ['domain', 'infra', 'utils', 'const', 'decorators'] as const) {
      expect(ALLOWED[lower], `${lower} must not depend on a transport layer`).not.toContain('handler')
      expect(ALLOWED[lower]).not.toContain('middleware')
      expect(ALLOWED[lower]).not.toContain('entry')
      expect(ALLOWED[lower]).not.toContain('di')
    }
    expect(ALLOWED.infra).not.toContain('domain')
    expect(ALLOWED.handler).not.toContain('infra')
  })

  test('binding and model inventories are read from the generated Env and Prisma schemas', () => {
    for (const name of ['DB', 'KV', 'OSS', 'HYPERDRIVE', 'VECTOR_V5_MAINTENANCE_WORKFLOW', 'CORE']) expect(context.bindings.has(name), name).toBe(true)
    for (const name of ['RUN_ENV', 'BACKEND_API_PREFIX']) expect(context.bindings.has(name), name).toBe(false)
    for (const name of ['sr_bookmark', 'sr_user', 'slax_user_bookmark_overview']) expect(context.models.has(name), name).toBe(true)
  })

  test('every API source file belongs to a known layer', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(files.filter(file => !layerOf(file))).toEqual([])
  })
})

describe('API source follows the layer rules', () => {
  const current = countViolations(violations)
  test('no new layer violation is introduced', () => {
    const added = Object.entries(current).filter(([key, count]) => count > (baseline[key] ?? 0))
    const details = added.flatMap(([key]) => violations.filter(violation => violationKey(violation) === key).map(describeViolation))
    expect(
      details,
      'Move the access into src/infra (injected into the caller) or import only from an allowed layer. Do not add entries to layerArchitecture.baseline.json without reviewer agreement.'
    ).toEqual([])
  })

  test('the baseline lists only violations that still exist', () => {
    const stale = Object.entries(baseline)
      .filter(([key, count]) => (current[key] ?? 0) < count)
      .map(([key, count]) => `${key}: baseline ${count}, now ${current[key] ?? 0}`)
    expect(stale, 'A violation was fixed. Lower or remove its entry in layerArchitecture.baseline.json.').toEqual([])
  })
})

describe('layer rule detectors', () => {
  const sample: Context = {
    bindings: new Map([
      ['DB', 'D1Database'],
      ['KV', 'KVNamespace'],
      ['CORE', 'Service<typeof import("./src/entry/core/index").default>'],
      ['ROOM', 'DurableObjectNamespace']
    ]),
    models: new Set(['sr_bookmark'])
  }
  const rules = (file: string, text: string) => analyzeSource(file, text, sample).map(violation => `${violation.rule} ${violation.detail}`)

  test.each([
    ['src/domain/a.ts', `export const load = (url: string) => fetch(url)`, 'io-fetch fetch'],
    ['src/utils/a.ts', `export const load = () => globalThis.fetch('https://example.com')`, 'io-fetch fetch'],
    ['src/handler/http/a.ts', `export const read = (ctx: any) => ctx.env.DB.prepare('x')`, 'env-binding DB'],
    ['src/domain/a.ts', `export const read = (env: any) => env['KV'].get('x')`, 'env-binding KV'],
    ['src/domain/a.ts', `export function read(env: any) { const { DB: database } = env; return database }`, 'env-binding DB'],
    ['src/domain/a.ts', `export const call = (env: any) => env.CORE.fetch('x')`, 'env-binding CORE'],
    ['src/entry/edge/a.ts', `export const read = (env: any) => env.KV.get('x')`, 'env-binding KV'],
    ['src/utils/a.ts', `export const list = (db: any) => db.sr_bookmark.findMany()`, 'prisma prisma'],
    ['src/domain/a.ts', 'export const run = (db: any) => db.$queryRaw`SELECT 1`', 'prisma prisma'],
    ['src/domain/a.ts', `export const sql = 'DELETE FROM sr_bookmark WHERE id = 1'`, 'raw-sql DELETE'],
    ['src/domain/a.ts', `export const open = () => new WebSocket('wss://example.com')`, 'io-global WebSocket'],
    ['src/domain/a.ts', `import Stripe from 'stripe'\nexport const s = Stripe`, 'io-module stripe'],
    ['src/handler/http/a.ts', `import { Pool } from 'pg'\nexport const p = Pool`, 'io-module pg'],
    ['src/utils/a.ts', `import { Redis } from '@upstash/redis/cloudflare'\nexport const r = Redis`, 'io-module @upstash/redis'],
    ['src/domain/a.ts', `import { BookmarkRepo } from '@/infra/repository/dbBookmark'\nexport const r = new BookmarkRepo()`, 'infra-construct BookmarkRepo'],
    [
      'src/handler/http/a.ts',
      `import { BookmarkRepo } from '@/infra/repository/dbBookmark'\nexport type R = BookmarkRepo`,
      'layer-import handler -> infra @/infra/repository/dbBookmark'
    ],
    [
      'src/infra/repository/a.ts',
      `import { BookmarkService } from '../../domain/bookmark'\nexport const s = BookmarkService`,
      'layer-import infra -> domain ../../domain/bookmark'
    ],
    ['src/utils/a.ts', `import type { User } from '@/domain/user'\nexport type U = User`, 'layer-import utils -> domain (type) @/domain/user'],
    ['src/domain/a.ts', `export const load = () => import('@/entry/edge/workflows/crawlWorkflow')`, 'layer-import domain -> entry @/entry/edge/workflows/crawlWorkflow'],
    ['src/middleware/a.ts', `export { submitServerEvent } from '../domain/events'`, 'layer-import middleware -> domain ../domain/events'],
    ['src/const/a.ts', `import { MultiLangError } from '@/utils/multiLangError'\nexport const e = MultiLangError`, 'layer-import const -> utils @/utils/multiLangError'],
    ['src/domain/a.ts', `import { x } from '@/unknown/thing'\nexport const y = x`, 'layer-import domain -> unknown @/unknown/thing']
  ])('%s flags %#', (file, text, expected) => {
    expect(rules(file, text)).toContain(expected)
  })

  test.each([
    [
      'src/infra/repository/a.ts',
      `import { Pool } from 'pg'\nexport const list = (env: any, db: any) => [fetch('x'), env.DB.prepare('SELECT * FROM t'), db.sr_bookmark.findMany(), new Pool()]`
    ],
    ['src/di/data.ts', `import { PrismaClient } from '@prisma/client'\nexport const make = (env: any) => new PrismaClient({ adapter: env.DB })`],
    [
      'src/entry/core/a.ts',
      `import { BookmarkRepo } from '@/infra/repository/dbBookmark'\nexport const make = (env: any) => [new BookmarkRepo(env), env.CORE.fetch('x'), env.ROOM.get('x')]`
    ],
    [
      'src/domain/a.ts',
      `import { BookmarkRepo } from '@/infra/repository/dbBookmark'\nimport type { PrismaClient } from '@prisma/client'\nexport class S { constructor(private repo: BookmarkRepo, private db?: PrismaClient) {} }`
    ],
    ['src/domain/a.ts', `import { ContextManager } from '@/utils/context'\nexport const make = (ctx: any, env: any) => new ContextManager(ctx, env)`],
    ['src/handler/http/a.ts', `import { BookmarkService } from '@/domain/bookmark'\nimport { auth } from '@/middleware/auth'\nexport const h = [BookmarkService, auth]`],
    ['src/domain/a.ts', `export const text = 'Select the files from your library'\nexport const run = (env: any) => env.RUN_ENV`]
  ])('%s allows the expected pattern %#', (file, text) => {
    expect(rules(file, text)).toEqual([])
  })

  test('a file outside the known layers is rejected', () => {
    expect(() => rules('src/feature/a.ts', 'export const x = 1')).toThrow('outside the known layers')
  })
})
