import { WeiboData, TikHubWeiboResponse } from './weibo'
import { XHSData, TikHubXhsPgyResponse } from './xhs'

export interface TikHubBaseResponse<T> {
  code: number
  message: string
  message_zh?: string
  request_id?: string | null
  data: T | null
}

export type { WeiboData, XHSData, TikHubXhsPgyResponse, TikHubWeiboResponse }
