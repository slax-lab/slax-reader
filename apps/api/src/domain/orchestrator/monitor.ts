import { injectable, inject } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { TweetInfo } from '@/const/twitterapi/struct'
import { SocialMediaApi } from '../../infra/external/socialMedia'
import { CrawlService } from '../crawl'
import { BookmarkRepo, TweetMentionPO } from '@/infra/repository/dbBookmark'
import { BookmarkService } from '../bookmark'
import { processTargetUrl } from '@/utils/urlPolicie'
import { UserRepo } from '@/infra/repository/dbUser'

@injectable()
export class MonitoringOrchestrator {
  constructor(
    @inject(UserRepo) userRepo: UserRepo,
    private crawlService: CrawlService,
    private bookmarkService: BookmarkService,
    @inject(BookmarkRepo) private bookmarkData: BookmarkRepo
  ) {}

  public async monitorTwitterMention(ctx: ContextManager) {
    try {
      const monitorUsername = ctx.env.TWITTER_MONITORING_USERNAME
      if (!monitorUsername) {
        console.log('TWITTER_MONITORING_USERNAME not configured')
        return
      }

      // 计算时间范围：5分钟前到现在
      const now = new Date()
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
      const sinceTime = Math.floor(fiveMinutesAgo.getTime() / 1000).toString()

      console.log(`Monitoring Twitter mentions for @${monitorUsername} since ${sinceTime}`)

      // 获取所有提及（处理分页）
      const allTweets: TweetInfo[] = []
      let cursor: string | undefined = undefined
      let hasNextPage = true

      while (hasNextPage) {
        const response = await SocialMediaApi.fetchTwitterMentions(ctx.env, ctx.env.TWITTER_MONITORING_USERNAME, sinceTime, cursor)
        if (response.tweets && response.tweets.length > 0) {
          allTweets.push(...response.tweets)
        }

        hasNextPage = response.has_next_page
        cursor = response.next_cursor

        if (allTweets.length > 100) {
          console.warn('Too many tweets fetched, stopping pagination')
          break
        }
      }

      console.log(`Fetched ${allTweets.length} tweets`)

      if (allTweets.length === 0) return

      const newTweet = await this.saveTwitterMentions(ctx, allTweets)

      console.log(`Saved ${newTweet.length} new Twitter mentions`)

      for (const tweet of newTweet) {
        await this.processSingleMention(ctx, tweet)
      }
    } catch (error) {
      console.error('Error in monitorTwitterMention:', error)
    }
  }

  private async saveTwitterMentions(_ctx: ContextManager, tweets: TweetInfo[]) {
    const userBinds = await this.bookmarkData.getUserByTwitterIds(tweets.map(t => t.author.id))

    const twitterIdToUserId = new Map<string, number>()
    userBinds.forEach(bind => {
      twitterIdToUserId.set(bind.platform_id, bind.user_id)
    })

    const records = tweets
      .filter(tweet => twitterIdToUserId.has(tweet.author.id))
      .map(tweet => ({
        tweet_id: tweet.id,
        reply_tweet_id: tweet.isReply ? tweet.inReplyToId : '',
        reply_tweet_name: tweet.isReply ? tweet.inReplyToUsername : '',
        mention_twitter_id: tweet.author.id,
        mention_twitter_name: tweet.author.userName,
        mention_content: tweet.text,
        user_id: twitterIdToUserId.get(tweet.author.id)!,
        mention_time: new Date(tweet.createdAt)
      }))

    console.log(`Filtered to ${records.length} tweets with bound users`)

    return await this.bookmarkData.batchCreateTwitterMentionsRecords(records)
  }

  private async processSingleMention(ctx: ContextManager, tweet: TweetMentionPO) {
    const content = tweet.mention_content.toLowerCase()
    if (!content.includes('mark') && !content.includes('save')) {
      console.log(`Tweet ${tweet.tweet_id} does not contain mark/save keywords`)
      return
    }

    let targetUrl: string
    if (tweet.reply_tweet_id && tweet.reply_tweet_id.length > 0) {
      targetUrl = `https://x.com/${tweet.reply_tweet_name}/status/${tweet.reply_tweet_id}`
    } else {
      targetUrl = `https://x.com/${tweet.mention_twitter_name}/status/${tweet.tweet_id}`
    }

    console.log(`Processing bookmark for URL: ${targetUrl}`)

    await this.createBookmarkFromMention(ctx, tweet.user_id, targetUrl, tweet)
  }

  /**
   * 从提及创建书签
   */
  private async createBookmarkFromMention(ctx: ContextManager, userId: number, targetUrl: string, tweet: TweetMentionPO) {
    try {
      const target_url = new URL(targetUrl)
      const processedUrl = processTargetUrl(target_url)

      const lastBm = await this.bookmarkData.getBookmark(processedUrl, userId)

      const userCtx = new ContextManager(ctx.execution, ctx.env)
      userCtx.setHashIds(ctx.hashIds)
      userCtx.setUserInfo(userId, userId, '', ctx.getlang())

      // 创建书签
      const bmInfo = await this.bookmarkService.createBookmarkBase({
        ctx: userCtx,
        targetUrl: processedUrl,
        hostUrl: target_url.host,
        privateUser: userId,
        type: 0,
        title: '',
        icon: '',
        cover: lastBm?.content_cover ?? '',
        description: '',
        isArchive: false
      })

      if (!bmInfo) {
        console.error(`Failed to create bookmark for ${targetUrl}`)
        return
      }

      console.log(`Created bookmark ${bmInfo.id} for user ${userId} from Twitter mention ${tweet.tweet_id}`)

      await this.crawlService.createWorkflow(ctx.env, {
        url: processedUrl,
        bookmarkId: bmInfo.id,
        userId: userId,
        enUserId: userId,
        userLang: ctx.getlang(),
        callbackChatId: 0,
        callbackOriginMessageId: 0,
        ignoreGenerateTag: true
      })
      console.log(`Created workflow for bookmark ${bmInfo.id}`)
    } catch (error) {
      console.error(`Error creating bookmark from mention:`, error)
    }
  }
}
