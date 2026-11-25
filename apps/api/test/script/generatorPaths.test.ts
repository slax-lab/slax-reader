import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { API_ROOT, API_TSCONFIG, ROOT } from '../../script/root'
import { pullSchema } from '../../script/gen-pull'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

afterEach(() => {
  vi.resetAllMocks()
})

async function runScript(name: string, mocks: Record<string, unknown>, args: string[] = [], env: Record<string, string> = {}) {
  const filename = path.join(API_ROOT, 'script', name)
  const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href))
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  })
  const scriptProcess = { argv: ['node', filename, ...args], env, exitCode: 0, cwd: () => ROOT, exit: vi.fn() }
  const scriptConsole = { log: vi.fn(), error: vi.fn() }
  const exports = {}
  const context = vm.createContext({
    exports,
    module: { exports },
    process: scriptProcess,
    console: scriptConsole,
    require: (id: string) => {
      if (Object.hasOwn(mocks, id)) return mocks[id]
      if (id === './root') return { ROOT, API_ROOT, API_TSCONFIG }
      if (id === 'path' || id === 'node:path') return path
      if (id === 'node:url') return { pathToFileURL, fileURLToPath }
      if (id === 'typescript') return ts
      throw new Error(`Unexpected import: ${id}`)
    }
  })
  vm.runInContext(compiled.outputText, context, { filename })
  await new Promise(resolve => setImmediate(resolve))
  return { process: scriptProcess, console: scriptConsole }
}

describe('repository-root generator paths', () => {
  test('root hashids debug command round-trips its demonstration ID', async () => {
    const { spawnSync: spawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    const result = spawn('pnpm', ['api', '--', 'debug:hashids'], { cwd: ROOT, encoding: 'utf8', timeout: 15000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/^decodeId \[ 10000000 \]$/m)
    expect(spawnSync).not.toHaveBeenCalled()
  })

  test('root helper exports stable paths without changing cwd', async () => {
    const cwd = process.cwd()
    const chdir = vi.spyOn(process, 'chdir')
    try {
      vi.resetModules()
      const roots = await import('../../script/root')
      expect(roots.ROOT).toBe(path.resolve(fileURLToPath(new URL('../../../../', import.meta.url))))
      expect(roots.API_ROOT).toBe(path.join(ROOT, 'apps/api'))
      expect(roots.API_TSCONFIG).toBe(path.join(ROOT, 'apps/api/tsconfig.json'))
      expect(chdir).not.toHaveBeenCalled()
      expect(process.cwd()).toBe(cwd)
    } finally {
      chdir.mockRestore()
    }
  })

  test.each(['pgsql', 'logs'])('schema pull explicitly selects %s at root cwd', target => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>)
    expect(pullSchema([target])).toBe(0)
    expect(spawnSync).toHaveBeenCalledWith('prisma', ['db', 'pull', '--config', path.join(API_ROOT, `prisma/${target}.config.ts`)], { cwd: API_ROOT, stdio: 'inherit' })
  })

  test.each([{ args: [] }, { args: ['d1'] }, { args: ['prod'] }, { args: ['pgsql', '--force'] }])('schema pull rejects unsupported arguments $args', ({ args }) => {
    expect(() => pullSchema(args)).toThrow('usage: pnpm api -- gen:pull <pgsql|logs>')
    expect(spawnSync).not.toHaveBeenCalled()
  })

  test('schema pull preserves nonzero status and spawn failures', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 7 } as ReturnType<typeof spawnSync>)
    expect(pullSchema(['logs'])).toBe(7)
    vi.mocked(spawnSync).mockReturnValue({ status: null } as ReturnType<typeof spawnSync>)
    expect(pullSchema(['logs'])).toBe(1)
    vi.mocked(spawnSync).mockReturnValue({ error: new Error('missing prisma') } as ReturnType<typeof spawnSync>)
    expect(() => pullSchema(['logs'])).toThrow('missing prisma')
  })

  test('DI scans only API source and uses the root API tsconfig', async () => {
    const writes = vi.fn()
    const outsideClasses = vi.fn(() => {
      throw new Error('Scanned outside API src')
    })
    const insideClasses = vi.fn(() => [])
    const project = vi.fn(function () {
      return {
        getSourceFiles: () => [
          { getFilePath: () => path.join(ROOT, 'src/outside.ts'), getClasses: outsideClasses },
          { getFilePath: () => path.join(API_ROOT, 'src/example.ts'), getClasses: insideClasses }
        ]
      }
    })
    // The fake project declares no classes, so the entries it reads must resolve nothing either.
    const fsMock = { existsSync: fs.existsSync, readFileSync: () => '', statSync: fs.statSync, readdirSync: fs.readdirSync, mkdirSync: vi.fn(), writeFileSync: writes }
    await runScript('gen-di.ts', { fs: fsMock, 'ts-morph': { Project: project } })
    expect(project).toHaveBeenCalledWith({ tsConfigFilePath: API_TSCONFIG })
    expect(insideClasses).toHaveBeenCalledOnce()
    expect(outsideClasses).not.toHaveBeenCalled()
    expect(writes).toHaveBeenCalledWith(path.join(API_ROOT, 'src/di/generated/core/dependency.ts'), expect.stringContaining('initializeCore'))
    expect(writes).toHaveBeenCalledWith(path.join(API_ROOT, 'src/di/generated/ai/dependency.ts'), expect.stringContaining('initializeCore'))
  })

  test.each([
    ['gen-cron.ts', 'cron', 'cronjob.ts', "@Scheduled('0 * * * *') run() {}", 'handleCronjob'],
    ['gen-consumer.ts', 'queue', 'consumer.ts', "@Consumer({ channel: 'fixture', batch: true }) run() {}", 'handleMessage']
  ])('%s scans API handlers and retains relative imports', async (script, handler, output, method, exported) => {
    const controllerDir = path.join(API_ROOT, 'src/handler', handler)
    const writes = vi.fn()
    const read = vi.fn((filename: string) => {
      expect(filename).toBe(path.join(controllerDir, 'fixture.ts'))
      return `class FixtureController { ${method} }`
    })
    const readdir = vi.fn((directory: string) => {
      expect(directory).toBe(controllerDir)
      return ['fixture.ts']
    })
    await runScript(script, { fs: { existsSync: () => true, readdirSync: readdir, statSync: () => ({ isDirectory: () => false }), readFileSync: read, writeFileSync: writes } })
    expect(writes).toHaveBeenCalledWith(path.join(API_ROOT, 'src/di/generated/core', output), expect.stringContaining(`from '../../../handler/${handler}/fixture'`))
    expect(writes.mock.calls[0][1]).toContain(exported)
    expect(writes.mock.calls[0][1]).not.toContain(ROOT)
  })

  test('router retains its explicit controller list and API-relative output/imports', async () => {
    const reads: string[] = []
    const writes = vi.fn()
    await runScript('gen-routers.ts', {
      fs: {
        existsSync: () => true,
        readFileSync: (filename: string) => {
          if (filename === path.join(API_ROOT, 'src/const/routes.ts')) return 'export const AI_ROUTES: readonly string[] = []'
          reads.push(filename)
          return "@Controller('/fixture') class FixtureController { @Get('/test') run() {} }"
        },
        writeFileSync: writes
      }
    })
    expect(reads).toEqual(
      [
        'aigc',
        'bookmark',
        'bookmarkAi',
        'callback',
        'collection',
        'collectionVector',
        'mark',
        'share',
        'subscription',
        'tag',
        'rss',
        'feed',
        'user',
        'passkey',
        'diagnostic',
        'sync',
        'promotion',
        'apiKey',
        'events',
        'metrics',
        'youtubeArticle',
        'youtubeArticleAdmin',
        'podcast',
        'contentRecommendation',
        'search'
      ].map(name => path.join(API_ROOT, `src/handler/http/${name}Controller.ts`))
    )
    expect(writes).toHaveBeenCalledWith(path.join(API_ROOT, 'src/di/generated/core/readerRouter.ts'), expect.stringContaining("from '../../../handler/http/searchController'"))
    expect(writes.mock.calls[0][1]).toContain("router.get('/fixture/test'")
    expect(writes.mock.calls[0][1]).not.toContain(ROOT)
  })

  test.each([
    ['a controller serving both Workers', "'/v1/bookmark/add',", 'Controllers mix AI and Core routes; split them so each Worker bundles only its own: BookmarkController'],
    ['an AI route without a handler', "'/v1/aigc/missing',", 'AI_ROUTES lists paths without a handler: /v1/aigc/missing'],
    ['a double-quoted route', '"/v1/bookmark/add",', 'Controllers mix AI and Core routes; split them so each Worker bundles only its own: BookmarkController'],
    ['an entry that is not a string literal', '...EXTRA_ROUTES,', 'AI_ROUTES entries must be string literals, found ...EXTRA_ROUTES']
  ])('router generation rejects %s before writing', async (_case, extra, message) => {
    const writes = vi.fn()
    const routesFile = path.join(API_ROOT, 'src/const/routes.ts')
    const readFileSync = (file: string, encoding: BufferEncoding) => {
      const text = fs.readFileSync(file, encoding)
      return file === routesFile ? text.replace('export const AI_ROUTES: readonly string[] = [', `export const AI_ROUTES: readonly string[] = [\n  ${extra}`) : text
    }
    await expect(runScript('gen-routers.ts', { fs: { existsSync: fs.existsSync, readFileSync, writeFileSync: writes, mkdirSync: vi.fn() } })).rejects.toThrow(message)
    expect(writes).not.toHaveBeenCalled()
  })

  test('registers four task refresh actions on existing controllers after ordinary middleware', async () => {
    const writes = vi.fn()
    await runScript('gen-routers.ts', { fs: { existsSync: fs.existsSync, readFileSync: fs.readFileSync, writeFileSync: writes } })
    const written = (file: string) => writes.mock.calls.find(([target]) => target === path.join(API_ROOT, 'src/di/generated', file))?.[1] as string
    const output = written('ai/aiRouter.ts')
    const actions = [
      ['/v1/bookmark/vector/refresh', 'BookmarkAiController', 'handleUserBookmarkVectorRefreshRequest'],
      ['/v1/bookmark/preference/refresh', 'BookmarkAiController', 'handleUserBookmarkPreferenceRefreshRequest'],
      ['/v1/collection/vector/refresh', 'CollectionVectorController', 'handleUserCollectionVectorRefreshRequest'],
      ['/v1/collection/preference/refresh', 'CollectionVectorController', 'handleUserCollectionPreferenceRefreshRequest']
    ]
    for (const [pathname, controller, handler] of actions) {
      expect(output).toContain(
        `router.post('${pathname}', async (req: Request, ctx: ContextManager) => {\n  const controller = container.resolve(${controller})\n  return await controller.${handler}(ctx, req)\n})`
      )
      for (const middleware of ['auth(req, ctx, container)', 'requestLog(req, ctx)', 'rateLimit(req, ctx)']) {
        expect(output.indexOf(middleware)).toBeLessThan(output.indexOf(`router.post('${pathname}'`))
      }
    }
    expect(output).not.toContain('vectorRefreshController')
    expect(output).not.toContain('/internal/v1/vector-refresh')
    for (const [pathname] of actions) expect(written('core/readerRouter.ts')).not.toContain(`'${pathname}'`)
  })

  test('D1 diff resolves root-relative SQLite input, preserves filtering and exclusive writes', async () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: '-- slax_fts_ignored\n-- _cf_METADATA ignored\nCREATE TABLE fixture (id INTEGER);\n' }))
    const writes = vi.fn()
    const readdir = vi.fn(() => ['00002_previous.sql', '00007_latest.sql'])
    await runScript('gen-dao.ts', { 'node:child_process': { spawnSync: spawn }, 'node:fs': { readdirSync: readdir, writeFileSync: writes } }, ['fixtures/local.sqlite', 'fixture'])
    expect(readdir).toHaveBeenCalledWith(path.join(API_ROOT, 'prisma/d1_migrations'))
    expect(spawn).toHaveBeenCalledWith(
      'prisma',
      [
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        path.join(API_ROOT, 'prisma/schema.prisma'),
        '--script',
        '--config',
        path.join(API_ROOT, 'prisma/diff.config.ts')
      ],
      { cwd: API_ROOT, encoding: 'utf8', env: { D1_DIFF_DATABASE_URL: `file:${path.join(ROOT, 'fixtures/local.sqlite')}` } }
    )
    expect(writes).toHaveBeenCalledWith(path.join(API_ROOT, 'prisma/d1_migrations/00008_fixture.sql'), 'CREATE TABLE fixture (id INTEGER);\n', { flag: 'wx' })
  })

  test('D1 diff failure never writes a migration', async () => {
    const writes = vi.fn()
    await expect(
      runScript(
        'gen-dao.ts',
        {
          'node:child_process': { spawnSync: () => ({ status: 1 }) },
          'node:fs': { readdirSync: () => [], writeFileSync: writes }
        },
        ['fixture.sqlite', 'fixture']
      )
    ).rejects.toThrow('D1 migration diff failed')
    expect(writes).not.toHaveBeenCalled()
  })

  test.each([false, true])('Apple certificates clean repository-local temporary files (failure=%s)', async failure => {
    const temp = path.join(ROOT, '.apple-certs-fixture')
    const remove = vi.fn()
    const writes = vi.fn()
    const mkdtemp = vi.fn(() => temp)
    const download = vi.fn(() => {
      if (failure) throw new Error('fixture download failure')
    })
    const result = await runScript('gen-apple-certs.ts', {
      child_process: { execFileSync: download },
      fs: { mkdtempSync: mkdtemp, readFileSync: () => Buffer.from('fixture'), rmSync: remove, mkdirSync: vi.fn(), writeFileSync: writes },
      crypto: { createHash: () => ({ update: () => ({ digest: () => 'fixturehash' }) }) }
    })
    expect(mkdtemp).toHaveBeenCalledWith(path.join(ROOT, '.apple-certs-'))
    expect(download).toHaveBeenCalledWith('curl', ['-s', '-o', path.join(temp, 'APPLE_ROOT_CA_G3.cer'), 'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer'], {
      cwd: ROOT
    })
    expect(remove).toHaveBeenCalledWith(temp, { recursive: true, force: true })
    if (failure) {
      expect(writes).not.toHaveBeenCalled()
      expect(result.process.exit).toHaveBeenCalledWith(1)
    } else {
      expect(writes).toHaveBeenCalledWith(path.join(API_ROOT, 'src/di/generated/apple-certs.ts'), expect.stringContaining('APPLE_ROOT_CA_G3_FINGERPRINT = "FIXTUREHASH"'))
    }
  })

  test('fulltext relation pruning reads PostgreSQL read-only and writes root-relative exclusive SQL', async () => {
    const query = vi.fn(async (sql: string) => (sql.includes('SELECT') ? { rows: [{ user_id: 1, bookmark_id: 10 }] } : {}))
    const write = vi.fn(async () => {})
    await runScript(
      'prune-fulltext-relations.ts',
      {
        pg: {
          Client: class {
            connect = vi.fn(async () => {})
            query = query
            end = vi.fn(async () => {})
          }
        },
        'node:fs/promises': {
          readFile: vi.fn(async () =>
            JSON.stringify([
              {
                results: [
                  { user_id: 1, bookmark_id: 10 },
                  { user_id: 1, bookmark_id: 11 }
                ]
              }
            ])
          ),
          writeFile: write
        }
      },
      ['--mirror', 'fixtures/mirror.json', '--output-sql', 'fixtures/prune.sql'],
      { HYPERDRIVE_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1/fixture' }
    )
    expect(query.mock.calls[0]).toEqual(['BEGIN READ ONLY'])
    expect(query.mock.calls[1][0]).toContain('FROM sr_user_bookmark')
    expect(query.mock.calls.at(-1)).toEqual(['COMMIT'])
    expect(write).toHaveBeenCalledWith(path.join(ROOT, 'fixtures/prune.sql'), 'DELETE FROM slax_user_bookmark WHERE user_id = 1 AND bookmark_id IN (11);\n', { flag: 'wx' })
  })

  test('backfill keeps read-only SQL and root-relative exclusive output without loading dotenv', async () => {
    const query = vi.fn(async (sql: string) => (sql.includes('SELECT') ? { rows: [{ device_id: 'fixture', user_id: 1, bound_at: '2024-01-01' }] } : {}))
    const connect = vi.fn(async () => {})
    const end = vi.fn(async () => {})
    const write = vi.fn(async () => {})
    await runScript(
      'backfill-user-device-alias.ts',
      {
        pg: {
          Client: class {
            connect = connect
            query = query
            end = end
          }
        },
        'node:fs/promises': { writeFile: write }
      },
      ['--output-sql', 'fixtures/aliases.sql'],
      { LOGS_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1/fixture' }
    )
    expect(query.mock.calls[0]).toEqual(['BEGIN READ ONLY'])
    expect(query.mock.calls[1][0]).toContain('FROM user_logs')
    expect(query.mock.calls[2]).toEqual(['COMMIT'])
    expect(write).toHaveBeenCalledWith(path.join(ROOT, 'fixtures/aliases.sql'), expect.stringContaining('INSERT OR IGNORE INTO user_device_alias'), { flag: 'wx' })
    expect(end).toHaveBeenCalledOnce()
  })
})
