import { publicFetch } from '@/utils/publicFetch'
import { youtubePublicationTime } from '@/utils/sourcePublicationTime'
import { XHSData, WeiboData } from '@/const/moreapi/base'
import { TikHubXhsPgyResponse } from '@/const/moreapi/xhs'
import { TikHubWeiboResponse } from '@/const/moreapi/weibo'
import { TikHubRedditResponse, RedditData } from '@/const/moreapi/reddit'
import { TikHubWeixinResponse, TikHubWeixinContent, isWeixinImageShower } from '@/const/moreapi/weixin'
import { DajialaArticleUnavailableError } from '@/const/err'
import { TikHubYoutubeCaptionTrack, TikHubYoutubeCaptionListData, TikHubYoutubeCaptionContentData, TikHubYoutubeCaptionResponse } from '@/const/moreapi/youtube'
import { YoutubeCue } from '@/utils/htmlBuilder'
import { buildYoutubeCaptionDocument, captionBaseLanguage, captionKindFromTrack, toCompatCues, type YoutubeCaptionDocument } from '@/utils/youtubeCaption'
import { FetchThreePartyError } from '@/const/err'
import { TweetArticleAPIResponse, TweetArticleInfo, TweetInfo, TwitterAPIResponse, TwitterMentionsAPIResponse } from '@/const/twitterapi/struct'
import { fetchToutiaoArticle } from './toutiao'
import { fetchZhihuByUrl } from './zhihu'

type YoutubeCaptionData = Partial<TikHubYoutubeCaptionListData & TikHubYoutubeCaptionContentData> & { status?: string; job_id?: string }

function youtubeCaptionLanguage(code: unknown): string {
  return typeof code === 'string' ? captionBaseLanguage(code).split('-')[0] : ''
}

function logYoutubeCaption(videoId: string, branch: 'list' | 'direct' | 'track', reason: string, selected?: string, returned?: string): void {
  const languageCode = (code?: string) => (typeof code === 'string' && /^[a-z]{1,8}(?:[.-][a-z0-9]{1,8}){0,5}$/i.test(code) ? code : undefined)
  console.log(
    JSON.stringify({
      event: 'youtube_caption_selection',
      video_id: videoId,
      branch,
      reason,
      selected_language_code: languageCode(selected),
      returned_language_code: languageCode(returned)
    })
  )
}

export class SocialMediaApi {
  public static fetchToutiao(env: Pick<Env, 'TIKHUB_TOKEN'>, url: string) {
    return fetchToutiaoArticle(env.TIKHUB_TOKEN, url)
  }

  private static apifyApiUrl = 'https://api.apify.com/v2/acts'
  private static tikhubApiUrl = 'https://api.tikhub.io'

  private static async fetchTikHub<T>(env: Env, path: string, init?: { method?: string; searchParams?: Record<string, string>; body?: unknown; signal?: AbortSignal }): Promise<T> {
    const apiUrl = new URL(`${SocialMediaApi.tikhubApiUrl}${path}`)
    for (const [k, v] of Object.entries(init?.searchParams ?? {})) {
      apiUrl.searchParams.append(k, v)
    }

    const resp = await fetch(apiUrl.toString(), {
      method: init?.body ? 'POST' : (init?.method ?? 'GET'),
      headers: {
        Authorization: `Bearer ${env.TIKHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: init?.signal
    })

    if (!resp.ok) {
      const detail = path.startsWith(SocialMediaApi.youtubeCaptionPath) ? resp.status : await resp.text()
      console.error(`fetch tikhub ${path} failed, response is not ok: ${detail}`)
      throw FetchThreePartyError()
    }

    return resp.json<T>()
  }

  public static fetchZhihuByUrl(env: Env, rawUrl: string): Promise<{ title: string; content: string; author: string } | null> {
    return fetchZhihuByUrl(env, rawUrl)
  }

  /**
   * 根据小红书笔记链接获取笔记详情
   */
  public static async fetchXhsByUrl(env: Env, url: string): Promise<XHSData> {
    // https://www.xiaohongshu.com/explore/6824636a000000000c03bd2c?xsec_token=ABqsil1N3eppUu3Dyz4jt6CeOGBBB6vVYafJiSMMnFdnQ=&xsec_source=pc_feed
    const uUrl = new URL(url)
    const noteId = uUrl.pathname.split('/').pop()

    if (!noteId) {
      throw new Error('noteId is required')
    }

    const respData = await SocialMediaApi.fetchTikHub<TikHubXhsPgyResponse>(env, '/api/v1/xiaohongshu/pgy/get_note_detail', {
      body: { note_id: noteId }
    })
    if (respData.code !== 200 || !respData.data || respData.data.code !== 0 || !respData.data.data) {
      console.error(`fetch xhs failed, response code: ${respData.code}, inner code: ${respData.data?.code}, message: ${respData.message}`)
      throw FetchThreePartyError()
    }

    const data = respData.data.data

    // 转换为旧的 XHSData 格式
    return {
      xsec_token: '',
      user: {
        user_id: data.userId,
        nickname: data.name || data.userInfo.nickName,
        avatar: data.headPhoto || data.userInfo.avatar,
        xsec_token: ''
      },
      at_user_list: data.atUserList || [],
      time: data.time.createTime,
      note_id: data.noteId,
      title: data.title,
      ip_location: data.userInfo.location || '',
      share_info: {
        un_share: false
      },
      type: data.type === 2 ? 'video' : 'normal',
      desc: data.content,
      video: data.videoInfo
        ? {
            media: {
              video_id: Number(data.videoInfo.id) || 0,
              video: {
                md5: '',
                hdr_type: 0,
                drm_type: 0,
                stream_types: [],
                biz_name: 0,
                biz_id: '',
                duration: data.videoInfo.meta.duration
              },
              stream: {
                av1: [],
                h264: [
                  {
                    rotate: 0,
                    hdr_type: 0,
                    ssim: 0,
                    width: data.videoInfo.meta.width,
                    video_bitrate: 0,
                    avg_bitrate: 0,
                    default_stream: 1,
                    format: 'mp4',
                    video_duration: data.videoInfo.meta.duration,
                    psnr: 0,
                    duration: data.videoInfo.meta.duration,
                    weight: 0,
                    quality_type: 'normal',
                    height: data.videoInfo.meta.height,
                    backup_urls: [],
                    vmaf: 0,
                    volume: data.videoInfo.volume,
                    video_codec: 'h264',
                    audio_bitrate: 0,
                    audio_channels: 2,
                    master_url: data.videoInfo.videoUrl,
                    stream_type: 1,
                    size: 0,
                    fps: 30,
                    audio_codec: 'aac',
                    audio_duration: data.videoInfo.meta.duration,
                    stream_desc: ''
                  }
                ],
                h265: []
              }
            },
            image: {
              first_frame_fileid: data.videoInfo.firstFrame || '',
              thumbnail_fileid: data.videoInfo.thumbnail || ''
            },
            capa: {
              duration: data.videoInfo.meta.duration
            },
            consumer: {
              origin_video_key: data.videoInfo.originVideoKey || ''
            }
          }
        : ({} as any),
      last_update_time: data.time.updateTime,
      interact_info: {
        share_count: String(data.shareNum),
        followed: false,
        relation: '',
        liked: false,
        liked_count: String(data.likeNum),
        collected: false,
        collected_count: String(data.favNum),
        comment_count: String(data.cmtNum)
      },
      image_list: (data.imagesList || []).map(img => ({
        file_id: img.fileId,
        height: img.height,
        trace_id: img.traceId,
        info_list: [
          {
            image_scene: 'WB_DFT',
            url: img.url
          }
        ],
        url_default: img.url,
        stream: {},
        width: img.width,
        url: img.url,
        url_pre: img.url,
        live_photo: false
      })),
      tag_list: []
    }
  }

  /**
   * 获取微博详情
   */
  public static async fetchWeiboByUrl(env: Env, url: string): Promise<WeiboData> {
    // https://weibo.com/1642909335/JdIoGzBt3
    const uUrl = new URL(url)
    const mid = uUrl.pathname.split('/').pop()

    if (!mid) {
      throw new Error('mid is required')
    }

    const respData = await SocialMediaApi.fetchTikHub<TikHubWeiboResponse>(env, '/api/v1/weibo/web_v2/fetch_post_detail', {
      searchParams: { id: mid, is_get_long_text: 'true' }
    })
    if (respData.code !== 200 || !respData.data) {
      console.error(`fetch weibo failed, response code: ${respData.code}, message: ${respData.message}`)
      throw FetchThreePartyError()
    }

    const status = respData.data
    const pic_infos: any = {}
    const picMediaIds = new Set<string>()
    for (const item of status.mix_media_info?.items ?? []) {
      if (item.type !== 'pic') continue
      picMediaIds.add(item.id)
      pic_infos[item.id] = item.data
    }

    // 过滤出真实图片的 pic_ids（排除视频封面等非图片项），注意：无图帖子（纯文字/纯视频）TikHub 不返回 pic_ids，运行时为 undefined，需兜底
    const rawPicIds = status.pic_ids ?? []
    const pic_ids = picMediaIds.size > 0 ? rawPicIds.filter(pid => picMediaIds.has(pid)) : rawPicIds

    // 转换为旧的 WeiboData 格式
    return {
      visible: status.visible,
      created_at: status.created_at,
      id: Number(status.id),
      idstr: status.id,
      mid: status.mid,
      mblogid: status.bid || status.mid,
      user: {
        id: status.user.id,
        idstr: String(status.user.id),
        pc_new: 0,
        screen_name: status.user.screen_name,
        profile_image_url: status.user.profile_image_url,
        profile_url: status.user.profile_url,
        verified: status.user.verified,
        verified_type: status.user.verified_type,
        domain: '',
        weihao: '',
        verified_type_ext: status.user.verified_type_ext || 0,
        avatar_large: status.user.avatar_hd,
        avatar_hd: status.user.avatar_hd,
        follow_me: status.user.follow_me,
        following: status.user.following,
        mbrank: status.user.mbrank,
        mbtype: status.user.mbtype,
        v_plus: 0,
        user_ability: 0,
        planet_video: false,
        icon_list: []
      },
      can_edit: status.can_edit,
      textLength: status.textLength,
      annotations: [],
      source: status.source,
      favorited: status.favorited,
      rid: status.rid,
      pic_ids,
      pic_num: pic_ids.length,
      pic_infos,
      is_paid: status.is_paid,
      mblog_vip_type: status.mblog_vip_type,
      number_display_strategy: status.number_display_strategy,
      reposts_count: status.reposts_count,
      comments_count: status.comments_count,
      attitudes_count: status.attitudes_count,
      attitudes_status: 0,
      continue_tag: {
        title: '',
        pic: '',
        scheme: ''
      },
      isLongText: status.isLongText,
      longText: {} as any,
      mlevel: status.mlevel,
      content_auth: status.content_auth,
      is_show_bulletin: 0,
      comment_manage_info: status.comment_manage_info,
      share_repost_type: 0,
      topic_struct: [],
      title: {
        text: status.status_title || '',
        base_color: 0,
        icon_url: ''
      },
      mblogtype: status.mblogtype,
      showFeedRepost: false,
      showFeedComment: false,
      pictureViewerSign: false,
      showPictureViewer: false,
      rcList: [],
      analysis_extra: '',
      readtimetype: '',
      mixed_count: status.mixed_count,
      is_show_mixed: status.is_show_mixed,
      mblog_feed_back_menus_format: [],
      isSinglePayAudio: false,
      text: status.text,
      text_raw: status.text,
      ok: status.ok
    }
  }

  /**
   * 获取Reddit帖子详情
   */
  public static async fetchReddit(env: Env, url: string): Promise<RedditData> {
    // 从 URL 解析 postId: /r/xxx/comments/xxxxx/ => t3_xxxxx
    const regexp = /\/comments\/([a-zA-Z0-9]+)/
    const match = url.match(regexp)
    const rawPostId = match?.[1]

    if (!rawPostId) {
      throw new Error('Invalid Reddit URL: cannot extract post ID')
    }

    const postId = `t3_${rawPostId}`

    const respData = await SocialMediaApi.fetchTikHub<TikHubRedditResponse>(env, '/api/v1/reddit/app/fetch_post_details', {
      searchParams: { post_id: postId }
    })
    if (respData.code !== 200 || !respData.data) {
      console.error(`fetch reddit failed, response code: ${respData.code}, message: ${respData.message}`)
      throw FetchThreePartyError()
    }

    const post = respData.data.postsInfoByIds.find(p => p.id === postId)
    if (!post) {
      throw new Error(`Reddit post not found for ID: ${postId}`)
    }

    // 解析 media 类型
    let mediaType: 'image' | 'video' | 'gallery' | 'link' | 'text' = 'text'
    const mediaData: any = {}

    if (post.gallery && post.gallery.media && post.gallery.media.length > 0) {
      mediaType = 'gallery'
      mediaData.images = post.gallery.media.map(item => item.still?.source?.url).filter(Boolean)
      mediaData.thumbnail = post.thumbnail?.url
    } else if (post.media?.streaming) {
      mediaType = 'video'
      mediaData.videoUrl = post.media.download?.url || post.media.streaming.hlsUrl
      mediaData.thumbnail = post.thumbnail?.url
    } else if (post.media?.still?.source) {
      mediaType = 'image'
      mediaData.images = [post.media.still.source.url]
      mediaData.thumbnail = post.thumbnail?.url
    } else if (post.thumbnail && !post.url.includes('reddit.com')) {
      mediaType = 'link'
      mediaData.thumbnail = post.thumbnail.url
    }

    return {
      id: post.id,
      title: post.postTitle,
      content: post.content?.markdown || post.content?.richtext || post.content?.html || '',
      contentHtml: post.content?.html || '',
      author: {
        name: post.authorInfo.name,
        avatar: post.authorInfo.iconSmall?.url || post.authorInfo.newIcon?.url || null
      },
      subreddit: {
        name: post.subreddit.name,
        title: post.subreddit.title,
        icon: post.subreddit.styles.icon
      },
      createdAt: post.createdAt,
      score: post.score,
      commentCount: post.commentCount,
      url: post.url,
      permalink: post.permalink,
      media: {
        type: mediaType,
        ...mediaData
      }
    }
  }

  /** 获取微信文章（TikHub）。传输失败抛 FetchThreePartyError；空/不可用抛 DajialaArticleUnavailableError */
  public static async fetchWeixinArticle(env: Env, url: string): Promise<TikHubWeixinContent> {
    let cleanUrl = url
    try {
      const u = new URL(url)
      u.hash = ''
      cleanUrl = u.toString()
    } catch {
      cleanUrl = url.split('#')[0]
    }

    const respData = await SocialMediaApi.fetchTikHub<TikHubWeixinResponse>(env, '/api/v1/wechat_mp/v2/fetch_article_detail', {
      body: { url: cleanUrl, raw: true }
    })

    if (respData.code !== 200 || !respData.data?.content) {
      console.error(`fetch weixin failed, response code: ${respData.code}, message: ${respData.message}`)
      throw FetchThreePartyError()
    }

    const content = respData.data.content
    // 内容为空 → 业务终止，交上层兜底
    if (!content.content_noencode && !(content.picture_page_info_list?.length ?? 0)) {
      throw DajialaArticleUnavailableError('tikhub empty content')
    }
    // 图片流无有效图片 → 视为不可用
    if (isWeixinImageShower(content) && !(content.picture_page_info_list ?? []).some(p => p.cdn_url)) {
      throw DajialaArticleUnavailableError('tikhub image-shower without images')
    }

    return content
  }

  /**
   * 获取Twitter帖子详情
   */
  public static async fetchTwitter(env: Env, tweetIds: string[]): Promise<TweetInfo[]> {
    const url = new URL('https://api.twitterapi.io/twitter/tweets')
    url.searchParams.append('tweet_ids', tweetIds.join(','))

    const resp = (await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.APIFY_API_TOKEN
      }
    })) as Response

    if (!resp.ok) {
      console.error(`fetch ${url} failed, response is not ok: ${await resp.text()}`)
      throw FetchThreePartyError()
    }

    const data = await resp.json<TwitterAPIResponse>()
    if (data.status !== 'success') {
      console.error(`fetch ${url} failed, response is not ok: ${data.msg}`)
      throw FetchThreePartyError()
    }

    return data.tweets
  }

  /**
   * 获取Twitter文章详情
   */
  public static async fetchTwitterArticle(env: Env, tweetId: string): Promise<TweetArticleInfo> {
    const url = new URL('https://api.twitterapi.io/twitter/article')
    url.searchParams.append('tweet_id', tweetId)

    const resp = (await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.APIFY_API_TOKEN
      }
    })) as Response

    if (!resp.ok) {
      console.error(`fetch ${url} failed, response is not ok: ${await resp.text()}`)
      throw FetchThreePartyError()
    }

    const data = await resp.json<TweetArticleAPIResponse>()
    if (data.status !== 'success') {
      console.error(`fetch ${url} failed, response is not ok: ${data.msg}`)
      throw FetchThreePartyError()
    }

    return data.article
  }

  /**
   * 获取Twitter用户提及
   */
  public static async fetchTwitterMentions(env: Env, userName: string, sinceTime: string, cursor?: string): Promise<TwitterMentionsAPIResponse> {
    const url = new URL('https://api.twitterapi.io/twitter/user/mentions')
    url.searchParams.append('userName', userName)
    url.searchParams.append('sinceTime', sinceTime)
    if (cursor) {
      url.searchParams.append('cursor', cursor)
    }

    const resp = (await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.APIFY_API_TOKEN
      }
    })) as Response

    if (!resp.ok) {
      console.error(`fetch ${url} failed, response is not ok: ${await resp.text()}`)
      throw FetchThreePartyError()
    }

    const data = await resp.json<TwitterMentionsAPIResponse>()
    if (data.status !== 'success') {
      console.error(`fetch ${url} failed, response status: ${data.status}, message: ${data.message}`)
      throw FetchThreePartyError()
    }

    return data
  }

  static async fetchYoutubePublicationTime(videoId: string): Promise<string | undefined> {
    try {
      const page = await publicFetch(
        'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId),
        { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; SlaxReaderBot/1.0)' } },
        { followRedirects: false, timeoutMs: 5000, maxBytes: 5 * 1024 * 1024 }
      )
      if (!page.ok) {
        await page.body?.cancel()
        return
      }
      return youtubePublicationTime(await page.text(), videoId)
    } catch {
      // Metadata is optional for saving the player and captions.
      return
    }
  }

  private static youtubeCaptionPath = '/api/v1/youtube/web_v2/get_video_captions'

  private static rankYoutubeCaptionTracks(tracks: TikHubYoutubeCaptionTrack[], userLanguage: string): TikHubYoutubeCaptionTrack[] {
    const byLanguage = new Map<string, TikHubYoutubeCaptionTrack[]>()
    const automaticLanguages = new Set<string>()
    for (const track of tracks) {
      const language = youtubeCaptionLanguage(track?.language_code)
      if (!language) continue
      const candidates = byLanguage.get(language) ?? []
      candidates.push(track)
      byLanguage.set(language, candidates)
      if (captionKindFromTrack(track) === 'asr') automaticLanguages.add(language)
    }

    // A single automatic language is the existing cue for the original audio. Several
    // automatic languages can come from dubs, so their order cannot identify the original.
    const preferred = automaticLanguages.size > 1 && userLanguage !== 'zh' ? 'en' : userLanguage
    const languages = automaticLanguages.size === 1 ? automaticLanguages : new Set([preferred, 'en'])
    if (!automaticLanguages.size && byLanguage.size === 1) {
      for (const language of byLanguage.keys()) languages.add(language)
    }

    const ranked = Array.from(languages).flatMap(language =>
      (byLanguage.get(language) ?? []).sort(
        (a, b) => Number(captionKindFromTrack(a) === 'asr') - Number(captionKindFromTrack(b) === 'asr') || a.language_code.localeCompare(b.language_code)
      )
    )
    const requestedCodes = new Set<string>()
    return ranked.filter(track => {
      const code = track.language_code.toLowerCase()
      if (requestedCodes.has(code)) return false
      requestedCodes.add(code)
      return true
    })
  }

  /**
   * TikHub data 字段声明为 anyOf[{}, null]，官方文档描述其可能是 JSON 字符串，需兼容解析。
   */
  private static normalizeTikHubData<T>(data: T | string | null): T | null {
    if (data === null) return null
    if (typeof data === 'string') {
      try {
        return JSON.parse(data) as T
      } catch {
        return null
      }
    }
    return data
  }

  private static async requestYoutubeCaptions(env: Env, videoId: string, params: Record<string, string>, signal: AbortSignal) {
    const request = (path: string, searchParams: Record<string, string>) =>
      SocialMediaApi.fetchTikHub<TikHubYoutubeCaptionResponse<YoutubeCaptionData>>(env, path, { searchParams, signal }).catch(() => {
        throw FetchThreePartyError('YouTube caption provider request failed')
      })
    let response = await request(SocialMediaApi.youtubeCaptionPath, { video_id: videoId, ...params })
    let jobId: string | undefined
    // TikHub recommends 2–5s between polls. Bound the wait so an upstream job cannot hang a crawl.
    for (let attempt = 0; ; attempt++) {
      const data = SocialMediaApi.normalizeTikHubData(response.data)
      if (response.code !== 200 || !data || typeof data !== 'object') throw FetchThreePartyError('Invalid YouTube caption response')
      if (!['processing', 'queued', 'active'].includes(data.status ?? '')) {
        if (data.status && data.status !== 'completed') throw FetchThreePartyError('YouTube caption job failed')
        return data
      }
      jobId = data.job_id || jobId
      if (!jobId) throw FetchThreePartyError('YouTube caption job is missing job_id')
      if (attempt >= 20) throw FetchThreePartyError('YouTube caption job timed out')
      await new Promise(resolve => setTimeout(resolve, 3000))
      signal.throwIfAborted()
      response = await request(`${SocialMediaApi.youtubeCaptionPath}_result`, { job_id: jobId, format: 'json3' })
    }
  }

  private static readYoutubeCaption(videoId: string, track: TikHubYoutubeCaptionTrack, data: YoutubeCaptionData): YoutubeCaptionDocument | string {
    if (data.video_id != null && data.video_id !== videoId) return 'video_mismatch'
    if (data.language_code != null && youtubeCaptionLanguage(data.language_code) !== youtubeCaptionLanguage(track.language_code)) return 'language_mismatch'
    const content = SocialMediaApi.normalizeTikHubData(data.content ?? null)
    if (!content || !Array.isArray(content.events)) return 'invalid_json3'
    const events = content.events.filter(
      event =>
        typeof event?.tStartMs === 'number' &&
        Number.isFinite(event.tStartMs) &&
        event.tStartMs >= 0 &&
        Array.isArray(event.segs) &&
        event.segs.every(segment => segment && (segment.utf8 == null || typeof segment.utf8 === 'string'))
    )
    const caption = buildYoutubeCaptionDocument(videoId, { ...track, language_name: data.language_name || track.language_name }, events)
    return caption.cues.length ? caption : 'no_timed_cues'
  }

  /**
   * Fetch the YouTube captions through TikHub. Returns the legacy cues for the player HTML and the
   * normalized caption document (milliseconds, duration, track, kind) for downstream processing.
   * The crawl passes the two-character preference from ContextManager.getlang().
   */
  public static async fetchYoutubeCaption(env: Env, videoId: string, userLang?: string): Promise<{ cues: YoutubeCue[]; caption: YoutubeCaptionDocument | null }> {
    // Bound HTTP time as well as poll count, across both list and content requests.
    const signal = AbortSignal.timeout(90_000)
    let listData: YoutubeCaptionData
    try {
      listData = await SocialMediaApi.requestYoutubeCaptions(env, videoId, {}, signal)
    } catch (error) {
      logYoutubeCaption(videoId, 'list', 'list_request_failed')
      throw error
    }
    if (listData.video_id != null && listData.video_id !== videoId) {
      logYoutubeCaption(videoId, 'list', 'video_mismatch')
      throw FetchThreePartyError('YouTube caption list video mismatch')
    }

    const userLanguage = userLang?.toLowerCase() || 'en'
    const directContent = !Array.isArray(listData.captions) && listData.status === 'completed' && listData.content != null
    let tracks: TikHubYoutubeCaptionTrack[]
    if (directContent) {
      const language = youtubeCaptionLanguage(listData.language_code)
      if (language !== 'en' && (language !== 'zh' || userLanguage !== 'zh')) {
        logYoutubeCaption(videoId, 'direct', 'ineligible_language', undefined, listData.language_code)
        return { cues: [], caption: null }
      }
      tracks = [{ language_code: listData.language_code!, language_name: listData.language_name ?? '', kind: '', is_translatable: false, base_url: '' }]
    } else if (Array.isArray(listData.captions)) {
      tracks = SocialMediaApi.rankYoutubeCaptionTracks(listData.captions, userLanguage)
      if (!tracks.length) {
        logYoutubeCaption(videoId, 'list', listData.captions.length ? 'no_eligible_track' : 'no_tracks')
        return { cues: [], caption: null }
      }
    } else {
      logYoutubeCaption(videoId, 'list', 'invalid_list')
      throw FetchThreePartyError('Invalid YouTube caption list')
    }

    const branch = directContent ? 'direct' : 'track'
    let failure = 'caption_timeout'
    for (const track of tracks.slice(0, 2)) {
      if (signal.aborted) break
      let data: YoutubeCaptionData
      try {
        data = directContent ? listData : await SocialMediaApi.requestYoutubeCaptions(env, videoId, { language_code: track.language_code, format: 'json3' }, signal)
      } catch {
        failure = 'content_request_failed'
        logYoutubeCaption(videoId, branch, failure, track.language_code)
        continue
      }
      const caption = SocialMediaApi.readYoutubeCaption(videoId, track, data)
      if (typeof caption === 'string') {
        failure = caption
        logYoutubeCaption(videoId, branch, failure, track.language_code, data.language_code)
        continue
      }
      logYoutubeCaption(videoId, branch, 'selected', track.language_code, data.language_code)
      return { cues: toCompatCues(caption.cues), caption }
    }
    throw FetchThreePartyError(`YouTube caption acquisition failed: ${failure}`)
  }

  /** Legacy entry point: cues only. */
  public static async fetchYoutubeCaptionCues(env: Env, videoId: string): Promise<YoutubeCue[]> {
    return (await SocialMediaApi.fetchYoutubeCaption(env, videoId)).cues
  }
}
