export interface TikHubYoutubeCaptionTrack {
  language_code: string
  language_name: string
  kind: string
  is_translatable: boolean
  base_url: string
}

export interface TikHubYoutubeCaptionListData {
  video_id: string
  captions: TikHubYoutubeCaptionTrack[]
}

export interface TikHubYoutubeJson3Event {
  tStartMs?: number
  dDurationMs?: number
  segs?: { utf8?: string }[]
}

export interface TikHubYoutubeCaptionContentData {
  video_id: string
  language_code: string
  language_name: string
  format: string
  content: { events?: TikHubYoutubeJson3Event[] } | string | null
}

export interface TikHubYoutubeCaptionResponse<T> {
  code: number
  message: string
  message_zh?: string
  data: T | string | null
}
