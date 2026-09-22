/**
 * TikHub 微信公众号文章接口类型
 * POST /api/v1/wechat_mp/v2/fetch_article_detail
 */

export interface TikHubWeixinPictureInfo {
  cdn_url: string
  width?: number
  height?: number
  // swiper 图片流专有字段，普通文章不含
  theme_color?: string
  is_qr_code?: number
  show_watermark?: boolean
  bottom_right_brightness?: number
  disable_theme_color?: boolean
  watermark_info?: {
    cdn_url: string
    is_uploader: boolean
  }
  live_photo?: {
    vid?: string
    type?: number
    format_info: Array<{
      format_id?: number
      url: string
      file_size?: number
      duration?: number
      width?: number
      height?: number
    }>
  }
}

export interface TikHubWeixinContent {
  user_name?: string
  nick_name: string
  title: string
  desc?: string
  author?: string
  round_head_img?: string
  create_time?: string
  content_noencode: string
  content_text?: string
  lang?: string
  item_show_type?: number
  real_item_show_type?: number
  style_type?: number
  page_type?: number
  picture_page_info_list?: TikHubWeixinPictureInfo[]
  itemPictureUrls?: string[]
}

export interface TikHubWeixinResponse {
  code: number
  message?: string
  message_zh?: string
  data: {
    itemShowType?: number
    url?: string
    content: TikHubWeixinContent
  } | null
}

/** 是否 swiper 图片流。不能用 picture 字段判定，普通文章配图也带 theme_color 会误判 */
export function isWeixinImageShower(content: TikHubWeixinContent): boolean {
  return content.item_show_type === 8 || content.real_item_show_type === 8
}

/** legacy 原始 HTML 是否图片流：图片流页才带 `#js_image_desc`（无 DOM，故字符串匹配） */
export function isWeixinLegacyImageShower(html: string): boolean {
  return /id=["']js_image_desc["']/.test(html)
}

export function parseWeixinCreateTime(raw?: string | number): Date {
  if (raw === undefined || raw === null || raw === '') return new Date()
  if (typeof raw === 'number' || /^\d+$/.test(raw)) {
    const n = Number(raw)
    const ms = String(raw).length <= 10 ? n * 1000 : n
    const d = new Date(ms)
    return isNaN(d.getTime()) ? new Date() : d
  }
  const d = new Date(raw)
  return isNaN(d.getTime()) ? new Date() : d
}
