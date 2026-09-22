import { describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ErrorName, MarkType } from '@slax-reader/contracts'
import type { ApiResponse, ApiKeyListItem, CreateApiKeyRequest, CreateMarkRequest, CreateMarkResponse, BookmarkExportResponse } from '@slax-reader/contracts'
import { ErrorName as LegacyErrorName } from '@/const/err'
import { MarkService } from '@/domain/mark'
import type { MarkDetail, MarkCommentItem } from '@slax-reader/contracts'
import { MarkRepo, markType } from '@/infra/repository/dbMark'
import { MultiLangError } from '@/utils/multiLangError'
import { Successed, Failed } from '@/utils/responseUtils'
import { ApiKeyController } from '@/handler/http/apiKeyController'
import { ApiKeyService } from '@/domain/apiKey'
import { MarkController } from '@/handler/http/markController'
import { BookmarkController } from '@/handler/http/bookmarkController'
import { createMockCtx } from '@test/helpers/mockFactory'

const post = (body: unknown) => new Request('https://api.test/', { method: 'POST', body: JSON.stringify(body) })

describe('shared HTTP contracts at the serialization boundary', () => {
  test('repository and service emit parsed mark source/anchors and retain the empty-list fallback', async () => {
    const createdAt = new Date('2026-09-22T00:00:00.000Z')
    const source = [{ type: 'text' as const, xpath: '/p', start_offet: 0, end_offset: 5 }]
    const row = {
      id: 7,
      uuid: 'mark-uuid',
      user_id: 1,
      bookmark_id: 8,
      type: MarkType.LINE,
      source: JSON.stringify(source),
      approx_source: '',
      comment: '',
      created_at: createdAt,
      updated_at: createdAt,
      is_deleted: false,
      parent_id: 0,
      root_id: 7,
      metadata: {}
    }
    const repo = new MarkRepo(
      () => ({}) as never,
      () => ({ sr_bookmark_comment: { findMany: vi.fn().mockResolvedValue([row]) } }) as never
    )
    const service = new MarkService({} as never, repo, {} as never, { getUserInfoList: vi.fn().mockResolvedValue([]) } as never)
    const ctx = createMockCtx({ hashIds: { encodeId: (id: number) => id } })
    const result = await service.getBookmarkMarkList(ctx, { id: 8, isShowMarks: true })
    expect(await Successed(result).json()).toEqual({
      code: 200,
      message: 'ok',
      data: {
        mark_list: [
          {
            id: 7,
            uuid: 'mark-uuid',
            user_id: 1,
            type: MarkType.LINE,
            source,
            approx_source: {},
            comment: '',
            created_at: createdAt.toISOString(),
            is_deleted: false,
            parent_id: 0,
            root_id: 7
          }
        ],
        user_list: { 0: { id: 0, username: 'Deleted', avatar: '' } }
      }
    } satisfies ApiResponse<MarkDetail>)
    const hidden = await service.getBookmarkMarkList(ctx, { id: 8, isShowMarks: false })
    expect(await Successed(hidden).json()).toEqual({ code: 200, message: 'ok', data: { mark_list: [], user_list: [] } } satisfies ApiResponse<MarkDetail>)
  })

  test('mark list preserves collection source and JSON dates', async () => {
    const row = {
      id: 7,
      uuid: 'mark-uuid',
      user_bookmark_uuid: 'bookmark-uuid',
      bookmark_id: 8,
      type: MarkType.LINE,
      content: '[]',
      approx_source: '{}',
      comment: '',
      created_at: new Date('2026-09-22T00:00:00.000Z'),
      source_type: 'collection',
      source_id: 'collection-code/8',
      metadata: {}
    }
    const service = new MarkService(
      { batchGetBookmarkTitle: vi.fn().mockResolvedValue([]) } as never,
      { listUserMark: vi.fn().mockResolvedValue([row]) } as never,
      {} as never,
      {} as never
    )
    const ctx = createMockCtx({ hashIds: { encodeId: (id: number) => id } })
    const result = await service.getMarkList(ctx, 1, 6)
    expect(await Successed(result).json()).toEqual({
      code: 200,
      message: 'ok',
      data: [
        {
          id: 7,
          uuid: 'mark-uuid',
          bookmark_user_uuid: 'bookmark-uuid',
          type: 'mark',
          content: [],
          approx_source: {},
          comment: '',
          title: '',
          color: '',
          parent_comment: '',
          created_at: row.created_at.toISOString(),
          source_type: 'collection',
          source_id: 'collection-code/8'
        }
      ]
    } satisfies ApiResponse<MarkCommentItem[]>)
  })

  test('all public error values and legacy imports survive extraction unchanged', () => {
    const expected = JSON.parse(readFileSync(new URL('../../fixtures/http-error-names.json', import.meta.url), 'utf8'))
    expect(ErrorName).toEqual(expected)
    expect(LegacyErrorName).toBe(ErrorName)
    expect(markType).toBe(MarkType)
    expect([MarkType.LINE, MarkType.COMMENT, MarkType.REPLY, MarkType.ORIGIN_LINE, MarkType.ORIGIN_COMMENT]).toEqual([1, 2, 3, 4, 5])
  })

  test('undefined data is omitted while explicit null remains present', async () => {
    const empty: ApiResponse<undefined> = { code: 200, message: 'ok' }
    const nullable: ApiResponse<null> = { data: null, code: 200, message: 'ok' }
    expect(await Successed().json()).toEqual(empty)
    expect(await Successed(null).json()).toEqual(nullable)
  })

  test.each([
    [404, 400],
    [401, 401],
    [418, 418],
    [429, 429]
  ])('business code %s retains its existing HTTP status %s', async (code, status) => {
    const response = Failed(new MultiLangError(ErrorName.NOT_FOUND, code, { en: 'Missing' }))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ data: ErrorName.NOT_FOUND, message: 'Missing', code } satisfies ApiResponse<ErrorName>)
  })

  test('API key service retains Date internally and the controller emits the shared string DTO', async () => {
    const createdAt = new Date('2026-09-22T00:00:00.000Z')
    const repo = { findByUserId: vi.fn().mockResolvedValue({ id: 7, name: 'CLI', keyPrefix: 'sr-test', createdAt }) }
    const service = new ApiKeyService(repo as never, {} as never)
    const controller = new ApiKeyController(service)
    const ctx = createMockCtx()
    expect((await service.listApiKeys(ctx))[0].created_at).toBe(createdAt)
    const response = await controller.handleListApiKeys(ctx, new Request('https://api.test/v1/user/api_keys'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      code: 200,
      message: 'ok',
      data: [{ id: 7, name: 'CLI', short_key: 'sr-test', created_at: createdAt.toISOString() }]
    } satisfies ApiResponse<ApiKeyListItem[]>)
  })

  test('shared request DTO keeps API key name fallback unchanged', async () => {
    const service = { createApiKey: vi.fn().mockResolvedValue(null) }
    const ctx = createMockCtx()
    await new ApiKeyController(service as never).handleCreateApiKey(ctx, post({} satisfies CreateApiKeyRequest))
    expect(service.createApiKey).toHaveBeenCalledWith(ctx, 'Default')
  })

  test('mark controller accepts numeric type and legacy offset spelling, preserves numeric IDs', async () => {
    const createMark = vi.fn().mockResolvedValue({ id: 1234, root_id: 1234, uuid: 'mark-uuid' })
    const ctx = createMockCtx()
    const request: CreateMarkRequest = {
      type: MarkType.LINE,
      bookmark_uid: 'bookmark-uuid',
      parent_id: 0,
      source: [{ type: 'text', xpath: '/p', start_offet: 0, end_offset: 5 }],
      select_content: [{ type: 'text', text: 'hello', src: '' }]
    }
    const response = await new MarkController({} as never, { createMark } as never).createMark(ctx, post(request))
    expect(createMark).toHaveBeenCalledWith(ctx, request)
    expect(await response.json()).toEqual({ data: { mark_id: 1234, root_id: 1234, mark_uid: 'mark-uuid' }, code: 200, message: 'ok' } satisfies ApiResponse<CreateMarkResponse>)
  })

  test('bookmark export retains its cursor envelope and no-store policy', async () => {
    const data: BookmarkExportResponse = {
      items: [
        {
          url: 'https://example.test/',
          title: 'saved',
          tags: [{ name: 'read', source: 'user' }],
          saved_at: '2026-09-22T00:00:00.000Z',
          is_read: false,
          is_archived: false,
          is_starred: true,
          type: 'article'
        }
      ],
      next_cursor: 'next-page'
    }
    const exportBookmarks = vi.fn().mockResolvedValue(data)
    const controller = Object.assign(Object.create(BookmarkController.prototype), { bookmarkService: { exportBookmarks } }) as BookmarkController
    const ctx = createMockCtx()
    const response = await controller.handleUserExportBookmarksRequest(ctx, new Request('https://api.test/v1/bookmark/export?cursor=last-page'))
    expect(exportBookmarks).toHaveBeenCalledWith(ctx, 'last-page')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data, code: 200, message: 'ok' } satisfies ApiResponse<BookmarkExportResponse>)
  })
})
