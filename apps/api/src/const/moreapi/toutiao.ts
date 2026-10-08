/** Narrow Web response shape. Provider data is validated before using this type. */
export interface TikHubToutiaoWebResponse {
  code: number
  data: {
    message: string
    data: {
      content: string
      delete?: number | string | boolean
      h5_extra?: {
        title?: string
        name?: string
        source?: string
        publish_stamp?: string | number
        str_group_id?: string
        media?: { name?: string }
      }
    }
  }
}

export interface ToutiaoArticle {
  articleId: string
  canonicalUrl: string
  title: string
  author: string
  siteName: 'Toutiao'
  publishedAt?: string
  html: string
  text: string
}
