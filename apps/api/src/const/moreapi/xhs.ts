export interface TikHubXhsPgyNoteData {
  noteId: string
  noteLink: string
  userId: string
  headPhoto: string
  name: string
  redId: string | null
  type: number
  atUserList: any[] | null
  title: string
  content: string
  imagesList: Array<{
    fileId: string
    url: string
    original: string
    width: number
    height: number
    latitude: string | null
    longitude: string | null
    traceId: string
    sticker: any | null
    imageExtraInfo: {
      livePhotoVideoId: string | null
      livePhotoVideoFileId: string | null
      imageMetadata: string
    }
  }>
  videoInfo: {
    id: string
    videoKey: string
    originVideoKey: string
    meta: {
      width: number
      height: number
      duration: number
      videoId: string
    }
    gifKey: string
    videoUrl: string
    gifUrl: string
    videoKeyList: any[]
    hasFragments: boolean
    thumbnail: string
    firstFrame: string
    volume: number
    chapters: any | null
    redGifInfo: any | null
  } | null
  time: {
    createTime: number
    updateTime: number
    userUpdateTime: number
  }
  createTime: string
  impNum: number
  likeNum: number
  favNum: number
  cmtNum: number
  readNum: number
  shareNum: number
  followCnt: number
  reportBrandUserId: string | null
  reportBrandName: string | null
  featureTags: string[] | null
  userInfo: {
    nickName: string
    avatar: string
    userId: string
    advertiserId: string | null
    fansNum: number
    cooperType: number
    priceState: number
    pictureState: number
    picturePrice: number
    videoState: number
    videoPrice: number
    userType: number
    operateState: number
    currentLevel: number
    location: string
    contentTags: string[] | null
    featureTags: string[]
    personalTags: string[] | null
    gender: string
    isCollect: boolean
    clickMidNum: number
    interMidNum: number
    pictureInCart: any | null
    videoInCart: any | null
    kolType: number
    mengagementNum: number
    mEngagementNum: number
  }
  compClickData: any | null
}

/**
 * 实测确认（2026-07-05，真实 token）：TikHub 外层 envelope 的 data 字段本身又包了一层
 * 蒲公英上游自己的响应结构 { code, msg, guid, success, data }，真正笔记数据在 data.data.data。
 */
export interface TikHubXhsPgyInnerResponse {
  code: number
  msg: string
  guid: string | null
  success: boolean
  data: TikHubXhsPgyNoteData | null
}

export interface TikHubXhsPgyResponse {
  code: number
  message: string
  message_zh?: string
  data: TikHubXhsPgyInnerResponse | null
}

export interface XHSData {
  xsec_token: string
  user: User
  at_user_list: any[]
  time: number
  note_id: string
  title: string
  ip_location: string
  share_info: ShareInfo
  type: string
  desc: string
  video: Video
  last_update_time: number
  interact_info: InteractInfo
  image_list: ImageList[]
  tag_list: TagList[]
}

export interface User {
  user_id: string
  nickname: string
  avatar: string
  xsec_token: string
}

export interface ShareInfo {
  un_share: boolean
}

export interface Video {
  media: Media
  image: Image
  capa: Capa
  consumer: Consumer
}

export interface Media {
  video_id: number
  video: Video2
  stream: Stream
}

export interface Video2 {
  md5: string
  hdr_type: number
  drm_type: number
  stream_types: number[]
  biz_name: number
  biz_id: string
  duration: number
}

export interface Stream {
  av1: any[]
  h264: H264[]
  h265: H265[]
  h266: any[]
}

export interface H264 {
  rotate: number
  hdr_type: number
  ssim: number
  width: number
  video_bitrate: number
  avg_bitrate: number
  default_stream: number
  format: string
  video_duration: number
  psnr: number
  duration: number
  weight: number
  quality_type: string
  height: number
  backup_urls: string[]
  vmaf: number
  volume: number
  video_codec: string
  audio_bitrate: number
  audio_channels: number
  master_url: string
  stream_type: number
  size: number
  fps: number
  audio_codec: string
  audio_duration: number
  stream_desc: string
}

export interface H265 {
  video_duration: number
  vmaf: number
  duration: number
  audio_bitrate: number
  height: number
  audio_duration: number
  weight: number
  video_bitrate: number
  quality_type: string
  stream_type: number
  format: string
  width: number
  hdr_type: number
  ssim: number
  default_stream: number
  master_url: string
  psnr: number
  video_codec: string
  stream_desc: string
  size: number
  backup_urls: string[]
  audio_codec: string
  audio_channels: number
  rotate: number
  volume: number
  avg_bitrate: number
  fps: number
}

export interface Image {
  first_frame_fileid: string
  thumbnail_fileid: string
}

export interface Capa {
  duration: number
}

export interface Consumer {
  origin_video_key: string
}

export interface InteractInfo {
  share_count: string
  followed: boolean
  relation: string
  liked: boolean
  liked_count: string
  collected: boolean
  collected_count: string
  comment_count: string
}

export interface ImageList {
  file_id: string
  height: number
  trace_id: string
  info_list: InfoList[]
  url_default: string
  stream: Stream2
  width: number
  url: string
  url_pre: string
  live_photo: boolean
}

export interface InfoList {
  image_scene: string
  url: string
}

export interface Stream2 {}

export interface TagList {
  id: string
  name: string
  type: string
}
