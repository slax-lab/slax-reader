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
import { buildYoutubeCaptionDocument, captionBaseLanguage, toCompatCues, type YoutubeCaptionDocument } from '@/utils/youtubeCaption'
import { FetchThreePartyError } from '@/const/err'
import { TweetArticleAPIResponse, TweetArticleInfo, TweetInfo, TwitterAPIResponse, TwitterMentionsAPIResponse } from '@/const/twitterapi/struct'
import { fetchToutiaoArticle } from './toutiao'
import { fetchZhihuByUrl } from './zhihu'

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
      console.error(`fetch tikhub ${path} failed, response is not ok: ${await resp.text()}`)
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

  /**
   * Pick the caption track to keep the original language of the video.
   * The ASR track (language_code `a.xx`, kind=asr) is always in the spoken language, so it tells
   * us the original language: manual track in that language → the ASR track itself.
   * Without an ASR track the original language is unknown: manual track in the user's language →
   * English track → first track. Translated tracks are never requested here.
   * The track list is sorted by language name, so the first track is often a translation
   * (`ar` for a video with many uploaded translations). English is the most likely original.
   * debt: a non-English video with uploaded translations and no ASR track still gets English.
   * Upgrade path: take the video's default audio language from its metadata.
   */
  private static pickYoutubeCaptionTrack(tracks: TikHubYoutubeCaptionTrack[], userLang?: string): TikHubYoutubeCaptionTrack | null {
    if (!tracks.length) return null
    const base = (t: TikHubYoutubeCaptionTrack) => captionBaseLanguage(t.language_code ?? '').split('-')[0]
    const isManual = (t: TikHubYoutubeCaptionTrack) => t.kind !== 'asr'
    const asr = tracks.find(t => t.kind === 'asr')
    if (asr) {
      const original = base(asr)
      return tracks.find(t => isManual(t) && base(t) === original) ?? asr
    }
    const user = (userLang ?? '').toLowerCase().split('-')[0]
    for (const lang of [user, 'en']) {
      const inLang = lang && tracks.find(t => isManual(t) && base(t) === lang)
      if (inLang) return inLang
    }
    return tracks[0]
  }

  /**
   * TikHub data 字段声明为 anyOf[{}, null]，官方文档描述其可能是 JSON 字符串，需兼容解析。
   */
  private static normalizeTikHubData<T>(data: T | string | null): T | null {
    if (data === null) return null
    if (typeof data === 'string') {
      try {
        return JSON.parse(data) as T
      } catch (err) {
        console.error(`failed to parse tikhub data string: ${err}`)
        return null
      }
    }
    return data
  }

  private static async requestYoutubeCaptions(env: Env, videoId: string, params: Record<string, string>, signal: AbortSignal) {
    type Data = Partial<TikHubYoutubeCaptionListData & TikHubYoutubeCaptionContentData> & { status?: string; job_id?: string }
    let response = await SocialMediaApi.fetchTikHub<TikHubYoutubeCaptionResponse<Data>>(env, SocialMediaApi.youtubeCaptionPath, {
      searchParams: { video_id: videoId, ...params },
      signal
    })
    let jobId: string | undefined
    // TikHub recommends 2–5s between polls. Bound the wait so an upstream job cannot hang a crawl.
    for (let attempt = 0; ; attempt++) {
      const data = SocialMediaApi.normalizeTikHubData(response.data)
      if (response.code !== 200 || !data || typeof data !== 'object') throw FetchThreePartyError('Invalid YouTube caption response')
      if (!['processing', 'queued', 'active'].includes(data.status ?? '')) {
        if (data.status && data.status !== 'completed') throw FetchThreePartyError(`YouTube caption job ${data.status}`)
        return data
      }
      jobId = data.job_id || jobId
      if (!jobId) throw FetchThreePartyError('YouTube caption job is missing job_id')
      if (attempt >= 20) throw FetchThreePartyError('YouTube caption job timed out')
      await new Promise(resolve => setTimeout(resolve, 3000))
      response = await SocialMediaApi.fetchTikHub<TikHubYoutubeCaptionResponse<Data>>(env, `${SocialMediaApi.youtubeCaptionPath}_result`, {
        searchParams: { job_id: jobId, format: 'json3' },
        signal
      })
    }
  }

  /**
   * Fetch the YouTube captions through TikHub. Returns the legacy cues for the player HTML and the
   * normalized caption document (milliseconds, duration, track, kind) for downstream processing.
   * `userLang` is only the fallback when the original language cannot be told from the tracks.
   */
  public static async fetchYoutubeCaption(env: Env, videoId: string, userLang?: string): Promise<{ cues: YoutubeCue[]; caption: YoutubeCaptionDocument | null }> {
    // Bound HTTP time as well as poll count, across both list and content requests.
    const signal = AbortSignal.timeout(90_000)
    const listData = await SocialMediaApi.requestYoutubeCaptions(env, videoId, {}, signal)
    // An async list request may complete with the caption content directly.
    const directContent = listData.status === 'completed' && listData.content != null && listData.language_code
    if (!directContent && !Array.isArray(listData.captions)) throw FetchThreePartyError('Invalid YouTube caption list')
    const track = directContent
      ? {
          language_code: listData.language_code!,
          language_name: listData.language_name ?? '',
          kind: listData.language_code!.startsWith('a.') ? 'asr' : '',
          is_translatable: false,
          base_url: ''
        }
      : SocialMediaApi.pickYoutubeCaptionTrack(listData.captions!, userLang)
    if (!track) return { cues: [], caption: null }

    const contentData = directContent
      ? listData
      : await SocialMediaApi.requestYoutubeCaptions(
          env,
          videoId,
          {
            language_code: track.language_code,
            format: 'json3'
          },
          signal
        )
    const content = SocialMediaApi.normalizeTikHubData(contentData.content ?? null)
    if (!content || !Array.isArray(content.events)) throw FetchThreePartyError('Invalid YouTube json3 caption content')
    const caption = buildYoutubeCaptionDocument(videoId, { ...track, language_name: contentData.language_name || track.language_name }, content.events)
    return { cues: toCompatCues(caption.cues), caption }
  }

  /** Legacy entry point: cues only. */
  public static async fetchYoutubeCaptionCues(env: Env, videoId: string): Promise<YoutubeCue[]> {
    return (await SocialMediaApi.fetchYoutubeCaption(env, videoId)).cues
  }
}
