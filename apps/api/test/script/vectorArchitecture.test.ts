import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, test, vi } from 'vitest'
vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  WorkerEntrypoint: class {},
  DurableObject: class {}
}))
vi.mock('cloudflare:workflows', () => ({
  NonRetryableError: class extends Error {}
}))
vi.mock('@/entry/core', () => ({ default: { fetch: vi.fn() } }))
vi.mock('agents/mcp', () => ({ McpAgent: class {} }))
import { container } from '../../src/decorators/di'
import '../../src/di/generated/dependency'
import { API_ROOT } from '../../script/root'

const read = (file: string) => fs.readFileSync(path.join(API_ROOT, file), 'utf8')
const violations = (file: string, check: (node: ts.Node) => boolean): string[] => {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const result: string[] = []
  const visit = (node: ts.Node) => {
    if (check(node)) result.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}
const applicationFiles = [
  'src/domain/vectorMaintenance.ts',
  'src/domain/orchestrator/contentRecommendation.ts',
  'src/domain/contentRecommendation.ts',
  'src/handler/http/contentRecommendationController.ts',
  'src/handler/http/bookmarkController.ts',
  'src/handler/http/collectionController.ts',
  'src/entry/edge/workflows/vectorMaintenanceWorkflow.ts'
]

describe('vector feature follows existing application architecture', () => {
  test.each(applicationFiles)('%s does not construct database infrastructure or execute SQL', file => {
    expect(violations(file, node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'pg')).toEqual([])
    expect(
      violations(
        file,
        node => ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ['Pool', 'Client', 'PrismaClient', 'HyperdrivePrismaClient'].includes(node.expression.text)
      )
    ).toEqual([])
    expect(
      violations(
        file,
        node => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) && /^(SELECT|INSERT|UPDATE|DELETE|WITH)\s/i.test(node.text.trim())
      )
    ).toEqual([])
  })

  test.each(['src/domain/vectorMaintenance.ts', 'src/domain/contentRecommendation.ts'])('%s declares injectable dependencies rather than opening a runtime', file => {
    const source = read(file)
    expect(/@(injectable|singleton)\(/.test(source), `${file}: missing injectable decorator`).toBe(true)
    expect(/@inject\(/.test(source), `${file}: missing constructor injection`).toBe(true)
    expect(source.includes('openVectorMaintenance'), `${file}: manual runtime factory remains`).toBe(false)
    expect(source.includes('validateRequest('), `${file}: request validation remains in Domain`).toBe(false)
  })

  test('recommendation Controller injects the orchestrator and keeps HTTP-only responsibilities', () => {
    const controller = 'src/handler/http/contentRecommendationController.ts'
    const source = read(controller)
    expect(/@inject\(ContentRecommendationOrchestrator\)/.test(source), 'Controller must inject ContentRecommendationOrchestrator').toBe(true)
    expect(/@inject\(ContentRecommendationService\)/.test(source), 'Controller must not inject the ranking Service directly').toBe(false)
    expect(/new\s+ContentRecommendationOrchestrator/.test(source), 'Controller must not construct its orchestrator').toBe(false)
    expect(
      violations(controller, node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.includes('domain/events'))
    ).toEqual([])
    expect(source).not.toMatch(/crypto\.randomUUID|recommendationAlgorithm|recommendation_served|recommendation_feedback|impression_id/)
    const orchestrator = read('src/domain/orchestrator/contentRecommendation.ts')
    expect(/@inject\(ContentRecommendationService\)/.test(orchestrator), 'Orchestrator must inject the ranking Service').toBe(true)
    expect(/new\s+ContentRecommendationService/.test(orchestrator), 'Orchestrator must not construct the ranking Service').toBe(false)
  })

  test('generated DI resolves Controller -> Orchestrator -> Service with local fixture dependencies', async () => {
    const generated = read('src/di/generated/dependency.ts')
    expect(generated).toContain('new ContentRecommendationController(container.resolve(ContentRecommendationOrchestrator))')
    expect(generated).toContain('new ContentRecommendationOrchestrator(container.resolve(ContentRecommendationService))')
    expect(generated).toContain('new ContentRecommendationService(container.resolve(ContentRecommendationRepo), container.resolve(VectorMaintenanceService))')
    const { ContentRecommendationOrchestrator } = await import('../../src/domain/orchestrator/contentRecommendation')
    const { ContentRecommendationController } = await import('../../src/handler/http/contentRecommendationController')
    const { ContentRecommendationService } = await import('../../src/domain/contentRecommendation')
    const { ContentRecommendationRepo } = await import('../../src/infra/repository/dbContentRecommendation')
    const { VectorMaintenanceService } = await import('../../src/domain/vectorMaintenance')
    const repo = {
      getArticleCandidates: vi.fn(),
      getLatestCandidates: vi.fn(),
      getPopularCandidates: vi.fn(),
      getCollectionCandidates: vi.fn(),
      getRecentMembers: vi.fn()
    }
    const vectors = {
      readArticleProfile: vi.fn(),
      readUser: vi.fn(),
      readArticles: vi.fn(),
      readCollections: vi.fn(),
      queryArticles: vi.fn(),
      queryCollections: vi.fn()
    }
    const isolated = container.clone()
    isolated.registerInstance(ContentRecommendationRepo, repo as never)
    isolated.registerInstance(VectorMaintenanceService, vectors as never)
    const service = isolated.resolve(ContentRecommendationService)
    const orchestrator = isolated.resolve(ContentRecommendationOrchestrator)
    const controller = isolated.resolve(ContentRecommendationController)
    expect(service).toBeInstanceOf(ContentRecommendationService)
    expect(orchestrator).toBeInstanceOf(ContentRecommendationOrchestrator)
    expect(controller).toBeInstanceOf(ContentRecommendationController)
    expect((service as any).repo).toBe(repo)
    expect((service as any).vectors).toBe(vectors)
    expect((orchestrator as any).recommendations).toBe(service)
    expect((controller as any).recommendations).toBe(orchestrator)
  })

  test.each([
    'src/domain/orchestrator/bookmark.ts',
    'src/domain/share.ts',
    'src/domain/user.ts',
    'src/domain/userDeletion.ts',
    'src/handler/cron/collectionJob.ts',
    'src/infra/repository/dbSyncBatch.ts'
  ])('%s does not dynamically import vector hooks', file => {
    expect(
      violations(
        file,
        node =>
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments.some(arg => ts.isStringLiteral(arg) && arg.text.includes('vectorMaintenance'))
      )
    ).toEqual([])
  })

  test.each(['src/infra/repository/dbCollection.ts', 'src/infra/repository/dbSyncBatch.ts', 'src/infra/repository/dbBookmarkFork.ts'])('%s does not dispatch domain work', file => {
    expect(
      violations(
        file,
        node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly && /(^|\/)domain\//.test(node.moduleSpecifier.text)
      )
    ).toEqual([])
    const source = read(file)
    expect(source).not.toMatch(/\b(?:dispatchVectorMaintenance|enqueueVectorMaintenance|waitUntil|beforeUpdate)\b/)
  })

  test('task refresh uses the four existing Controller routes, a Core-only secret helper and the anonymous whitelist', () => {
    expect(fs.existsSync(path.join(API_ROOT, 'src/handler/http/vectorRefreshController.ts'))).toBe(false)
    expect(fs.existsSync(path.join(API_ROOT, 'src/middleware/vectorRefreshAuth.ts'))).toBe(false)
    for (const file of ['src/entry/core/index.ts', 'src/entry/edge/index.ts']) {
      expect(/isVectorRefreshRequest|handleVectorRefreshRequest|authorizeVectorRefresh|requireVectorRefreshSecret/.test(read(file)), file).toBe(false)
    }
    const bookmark = read('src/handler/http/bookmarkController.ts')
    const collection = read('src/handler/http/collectionController.ts')
    expect(bookmark).toContain("@Post('/vector/refresh')")
    expect(bookmark).toContain("@Post('/preference/refresh')")
    expect(collection).toContain("@Post('/vector/refresh')")
    expect(collection).toContain("@Post('/preference/refresh')")
    for (const [source, paths] of [
      [bookmark, ['/v1/bookmark/vector/refresh', '/v1/bookmark/preference/refresh']],
      [collection, ['/v1/collection/vector/refresh', '/v1/collection/preference/refresh']]
    ] as const) {
      for (const path of paths) expect(source).toContain(`pathname !== '${path}'`)
      expect(source).not.toMatch(/user_bookmark_id|subscription_id|refreshBookmark|refreshOwnedCollection|refreshSubscription/)
    }
    for (const handler of ['handleUserBookmarkVectorRefreshRequest', 'handleUserBookmarkPreferenceRefreshRequest', 'handleUserCollectionVectorRefreshRequest', 'handleUserCollectionPreferenceRefreshRequest']) {
      const source = handler.startsWith('handleUserBookmark') ? bookmark : collection
      const handlerStart = source.indexOf(`public async ${handler}(`)
      const secret = source.indexOf('requireVectorRefreshSecret(request, ctx.env)', handlerStart)
      const path = source.indexOf("pathname !== '", handlerStart)
      const body = source.indexOf('RequestUtils.json', handlerStart)
      expect(handlerStart).toBeGreaterThanOrEqual(0)
      expect(secret).toBeGreaterThan(handlerStart)
      expect(secret).toBeLessThan(path)
      expect(path).toBeLessThan(body)
    }

    const auth = read('src/middleware/auth.ts')
    expect(auth).not.toContain('authVectorRefresh')
    for (const path of ['/v1/bookmark/vector/refresh', '/v1/bookmark/preference/refresh', '/v1/collection/vector/refresh', '/v1/collection/preference/refresh']) {
      expect(auth).toContain(`'${path}'`)
    }
    const edge = read('src/entry/edge/index.ts')
    expect(edge).not.toContain('VECTOR_REFRESH_SECRET')
    expect(edge).not.toContain('X-Vector-Refresh-Secret')

    const helper = read('src/utils/vectorRefreshAuth.ts')
    expect(helper).toContain('requireVectorRefreshSecret')
    expect(helper).toContain('X-Vector-Refresh-Secret')
    expect(helper).toContain('VECTOR_REFRESH_SECRET')
    expect(helper).toContain("createHash('sha256')")
    expect(helper).toContain('timingSafeEqual')
    expect(helper).not.toMatch(/Authorization|X-API-Key|EDGE_IDENTITY/)
  })

  test('AiEntry is only RPC forwarding and the remote adapter avoids Entry dependencies', () => {
    const entry = read('src/entry/ai/index.ts')
    expect(entry).toContain("import { VectorIndexRepo } from '@/infra/repository/vectorIndexRepo'")
    expect(entry).not.toMatch(/invalid_v5|normalized\(|VECTOR_V5|VECTORIZE[1-5]/)
    for (const name of ['v5GetByIds', 'v5Upsert', 'v5DeleteByIds', 'v5Query']) expect(entry).not.toContain(name)
    for (const name of ['getVectorsByIds', 'upsertVectors', 'deleteVectorsByIds', 'queryVectors', 'query(', 'upsert(', 'deleteByIds(']) {
      expect(entry).toContain(name)
    }
    const adapter = read('src/infra/repository/vectorIndexClient.ts')
    expect(adapter).toContain("from './vectorIndexRepo'")
    expect(adapter).not.toMatch(/entry\/ai|AiEntry/)
    const repo = read('src/infra/repository/vectorIndexRepo.ts')
    expect(repo).not.toMatch(/entry\/ai|AiEntry/)
    expect(repo).toContain('VECTOR_V5_ARTICLE')
    expect(repo).toContain('invalid_v5_ids')
  })

  test('no source retains the removed v5 RPC names', () => {
    const files: string[] = []
    const walk = (directory: string) => {
      for (const name of fs.readdirSync(path.join(API_ROOT, directory))) {
        const relative = path.posix.join(directory, name)
        const stat = fs.statSync(path.join(API_ROOT, relative))
        if (stat.isDirectory()) walk(relative)
        else if (relative.endsWith('.ts') && /^(src|script)\//.test(relative)) files.push(relative)
      }
    }
    walk('src')
    walk('script')
    const offenders = files.filter(file => /v5GetByIds|v5Upsert|v5DeleteByIds|v5Query/.test(read(file)))
    expect(offenders).toEqual([])
  })

  test('base persistence and search normalization do not dispatch new-bookmark maintenance', () => {
    const source = read('src/domain/bookmark.ts')
    const start = source.indexOf('public async createBookmarkBase(')
    const end = source.indexOf('private async createInlineBookmark(', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(source.slice(start, end)).not.toMatch(/dispatchVectorMaintenance|enqueueVectorMaintenance/)
    expect(read('src/domain/search.ts')).not.toMatch(/dispatchVectorMaintenance|enqueueVectorMaintenance/)
  })

  test('refresh CLI has no checkpoint, login-token or relation-surrogate machinery', () => {
    const source = read('script/vector-refresh.ts')
    expect(/\b(?:Checkpoint|loadCheckpoint|scopeKey|atomicJson)\b/.test(source), 'refresh CLI must not retain checkpoint machinery').toBe(false)
    expect(source.includes('--checkpoint'), 'refresh CLI must not expose checkpoint files').toBe(false)
    expect(source.includes('--resume'), 'refresh CLI must not retain receipt recovery').toBe(false)
    expect(source).toContain('VECTOR_REFRESH_SECRET')
    expect(source).toContain("'X-Vector-Refresh-Secret'")
    expect(source).not.toMatch(/VECTOR_REFRESH_AUTH_TOKEN|VECTOR_BACKFILL_TOKEN|user_bookmark_id|subscription_id|sr_user_collection_subscriber|headers: \{ Authorization/)
  })
})
