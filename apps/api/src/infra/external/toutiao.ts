import type { TikHubToutiaoWebResponse, ToutiaoArticle } from '../../const/moreapi/toutiao'
import { publicFetch } from '../../utils/publicFetch'
import { buildToutiaoArticle } from '../../utils/toutiaoArticle'
import { resolveToutiaoUrl, ToutiaoCaptureError } from '../../utils/toutiaoUrl'

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const string = (value: unknown): string => (typeof value === 'string' ? value : '')

export async function fetchToutiaoArticle(token: string | undefined, url: string): Promise<ToutiaoArticle> {
  if (!token?.trim()) throw new ToutiaoCaptureError('TIKHUB_TOKEN is missing; export it in your shell environment')
  const { articleId, canonicalUrl } = await resolveToutiaoUrl(url)
  const endpoint = new URL('https://api.tikhub.io/api/v1/toutiao/web/get_article_info')
  endpoint.searchParams.set('aweme_id', articleId)
  let payload: unknown
  try {
    const response = await publicFetch(
      endpoint,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      { followRedirects: false, timeoutMs: 30_000, maxBytes: 5 * 1024 * 1024 }
    )
    if (!response.ok) {
      await response.body?.cancel()
      throw new ToutiaoCaptureError(`TikHub Toutiao request failed (HTTP ${response.status})`)
    }
    payload = await response.json()
  } catch (error) {
    if (error instanceof ToutiaoCaptureError) throw error
    throw new ToutiaoCaptureError('TikHub Toutiao request failed or returned invalid JSON')
  }
  if (
    !object(payload) ||
    payload.code !== 200 ||
    !object(payload.data) ||
    payload.data.message !== 'success' ||
    !object(payload.data.data) ||
    typeof payload.data.data.content !== 'string'
  ) {
    throw new ToutiaoCaptureError('TikHub Toutiao response is unsuccessful or has no article body')
  }
  const article = payload.data.data as TikHubToutiaoWebResponse['data']['data']
  if (article.delete === 1 || article.delete === '1' || article.delete === true) throw new ToutiaoCaptureError('Toutiao article has been deleted')
  const extra = object(article.h5_extra) ? article.h5_extra : {}
  if (typeof extra.str_group_id === 'string' && extra.str_group_id !== articleId) throw new ToutiaoCaptureError('TikHub Toutiao returned a different article ID')
  return buildToutiaoArticle({
    articleId,
    canonicalUrl,
    content: article.content,
    title: string(extra.title),
    author: string(extra.name) || (object(extra.media) ? string(extra.media.name) : '') || string(extra.source),
    publishStamp: typeof extra.publish_stamp === 'string' || typeof extra.publish_stamp === 'number' ? extra.publish_stamp : undefined
  })
}
