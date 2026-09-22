import type { ListTagsQuery, UpdateTagRequest, CreateTagRequest, PromoteTagRequest, TagRef } from '@slax-reader/contracts'
import { ErrorParam } from '../../const/err'
import { ContextManager } from '@/utils/context'
import { RequestUtils } from '../../utils/requestUtils'
import { Failed, Successed } from '../../utils/responseUtils'
import { Controller } from '../../decorators/controller'
import { inject } from '../../decorators/di'
import { TagService } from '../../domain/tag'
import { Get, Post } from '../../decorators/route'

/** "a,b,c" of hashids to DB ids; empty array when any part fails to decode */
export function decodeIdList(ctx: ContextManager, raw: string | number | undefined): number[] {
  if (raw === undefined || raw === null || raw === '') return []
  const parts = String(raw)
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0)
  const ids = parts.map(p => ctx.hashIds.decodeId(p as unknown as number) || 0)
  if (ids.length < 1 || ids.some(id => id < 1)) return []
  return [...new Set(ids)]
}

@Controller('/v1/tag')
export class TagController {
  constructor(@inject(TagService) private tagService: TagService) {}

  /**
   * 词表。带 within=a,b 时返回这批标签交集里还出现的候选词（含篇数），不含已选
   */
  @Get('/list')
  public async handleListTagsRequest(ctx: ContextManager, request: Request): Promise<Response> {
    const params = await RequestUtils.query<ListTagsQuery>(request)
    if (params.within) {
      const ids = decodeIdList(ctx, params.within)
      if (ids.length < 1) return Failed(ErrorParam())
      return Successed(await this.tagService.listCandidateTags(ctx, ids))
    }
    const tags = await this.tagService.listUserTags(ctx)
    return Successed(tags)
  }

  @Post('/update')
  public async handleUpdateTagRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<UpdateTagRequest>(request)
    if (!req || !req.tag_name || req.tag_name.length > 30) return Failed(ErrorParam())

    const tagId = await this.tagService.resolveTagId(ctx, req)
    if (tagId < 1) return Failed(ErrorParam())

    await this.tagService.editTag(ctx, tagId, req.tag_name)
    return Successed()
  }

  @Post('/create')
  public async handleCreateTagRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<CreateTagRequest>(request)
    if (!req || !req.tag_name || req.tag_name.length > 30) return Failed(ErrorParam())

    const res = await this.tagService.createTag(ctx, req.tag_name)
    return Successed(res)
  }

  /** 认领为我的标签。传 tag_name 时按归一化名字匹配，命中即认领，未命中新建 */
  @Post('/promote')
  public async handlePromoteTagRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<PromoteTagRequest>(request)
    if (!req || (!req.tag_id && !req.tag_uuid && !req.tag_name)) return Failed(ErrorParam())
    if (req.tag_name && req.tag_name.length > 30) return Failed(ErrorParam())

    const res = await this.tagService.promoteTag(ctx, req)
    return Successed(res)
  }

  /** 移出我的标签，关联不变 */
  @Post('/demote')
  public async handleDemoteTagRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<TagRef>(request)
    if (!req || (!req.tag_id && !req.tag_uuid)) return Failed(ErrorParam())

    const res = await this.tagService.demoteTag(ctx, req)
    return Successed(res)
  }

  /** 标签页的删除：从所有文章上移除，词表里隐藏 */
  @Post('/delete')
  public async handleDeleteTagRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<TagRef>(request)
    if (!req || (!req.tag_id && !req.tag_uuid)) return Failed(ErrorParam())

    await this.tagService.deleteTag(ctx, req)
    return Successed()
  }
}
