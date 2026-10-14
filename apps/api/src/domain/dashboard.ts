import { inject, singleton } from '../decorators/di'
import { LogsRepo } from '../infra/repository/dbLogs'
import { BookmarkRepo } from '../infra/repository/dbBookmark'

export interface TopArticleItem {
  uuid: string
  title: string
  link: string
  guest_uv: number // 访客人数(游客去重)
  guest_visits: number // 访客次数(游客人次)
  member_uv: number // 用户人数(登录用户去重)
  member_visits: number // 用户次数(登录用户人次)
}

@singleton()
export class DashboardService {
  constructor(
    @inject(LogsRepo) private repo: LogsRepo,
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo
  ) {}

  private toShanghaiDate(timeStr: string): Date {
    return new Date(timeStr.replace(' ', 'T') + '+08:00')
  }

  async getOverallMetrics(startTime: string, endTime: string) {
    return this.repo.queryOverall(this.toShanghaiDate(startTime), this.toShanghaiDate(endTime))
  }

  async getMetricsByPlatform(startTime: string, endTime: string) {
    return this.repo.queryByPlatform(this.toShanghaiDate(startTime), this.toShanghaiDate(endTime))
  }

  async getDailyMetrics(startTime: string, endTime: string) {
    return this.repo.queryDaily(this.toShanghaiDate(startTime), this.toShanghaiDate(endTime))
  }

  async getVisitOverview(startTime: string, endTime: string) {
    return this.repo.queryVisitOverview(this.toShanghaiDate(startTime), this.toShanghaiDate(endTime))
  }

  // 访问最多的文章(去重)，并解析出标题
  async getTopArticles(startTime: string, endTime: string, limit: number): Promise<TopArticleItem[]> {
    const rows = await this.repo.queryTopArticles(this.toShanghaiDate(startTime), this.toShanghaiDate(endTime), limit)
    const titleMap = await this.bookmarkRepo.queryTitlesByUuids(rows.map(r => r.uuid))
    return rows.map(r => ({
      uuid: r.uuid,
      title: titleMap.get(r.uuid) || '(已删除)',
      link: `/b/${r.uuid}`,
      guest_uv: r.guest_uv,
      guest_visits: r.guest_visits,
      member_uv: r.member_uv,
      member_visits: r.member_visits
    }))
  }

  async getBookmarkStepSuccess(startTime: string, endTime: string) {
    const start = this.toShanghaiDate(startTime)
    const end = this.toShanghaiDate(endTime)
    const [entry, steps] = await Promise.all([this.repo.queryBookmarkAddEntry(start, end), this.repo.queryBookmarkStepSuccess(start, end)])

    const decorated = steps
      .map(s => {
        const meta = STEP_FUNNEL_META[s.step_name] ?? { group: 'metadata' as const, order: 999 }
        return { ...s, group: meta.group, order: meta.order }
      })
      .sort((a, b) => a.order - b.order)

    return {
      entry: { step_name: 'bookmark_add', attempts: entry.attempts, bookmarks: entry.bookmarks, users: entry.users, success: entry.success, failed: entry.failed },
      funnel: decorated.filter(s => s.group === 'funnel'),
      metadata: decorated.filter(s => s.group === 'metadata')
    }
  }
}

const STEP_FUNNEL_META: Record<string, { group: 'funnel' | 'metadata'; order: number }> = {
  pre_check: { group: 'funnel', order: 0 },
  workflow_creation: { group: 'funnel', order: 1 },
  import_parse_workflow_creation: { group: 'funnel', order: 1 },
  inline_content: { group: 'funnel', order: 2 },
  twitter_fetching: { group: 'funnel', order: 2 },
  xiaohongshu_fetching: { group: 'funnel', order: 2 },
  weibo_fetching: { group: 'funnel', order: 2 },
  reddit_fetching: { group: 'funnel', order: 2 },
  weixin_fetching: { group: 'funnel', order: 2 },
  zyte_fetching: { group: 'funnel', order: 2 },
  fetching: { group: 'funnel', order: 2 },
  content_fetch_cached: { group: 'funnel', order: 2 },
  parsing: { group: 'funnel', order: 3 },
  complete: { group: 'funnel', order: 4 },
  // metadata 层（漏斗之外）
  embedding: { group: 'metadata', order: 101 },
  generate_overview_and_tags: { group: 'metadata', order: 102 },
  post_processing: { group: 'metadata', order: 103 },
  stuck_retry: { group: 'metadata', order: 104 },
  content_validation_run: { group: 'metadata', order: 105 },
  content_validation: { group: 'metadata', order: 106 }
}
