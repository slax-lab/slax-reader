interface TwitterAPIResponse {
  tweets: TweetInfo[]
  status: string
  msg: string
  code: number
}

interface TweetArticleAPIResponse {
  article: TweetArticleInfo
  status: string
  msg: string
}

interface TweetInfo {
  type: string
  id: string
  url: string
  twitterUrl: string
  text: string
  source: string
  retweetCount: number
  replyCount: number
  likeCount: number
  quoteCount: number
  viewCount: number
  createdAt: string
  lang: string
  bookmarkCount: number
  isReply: boolean
  inReplyToId: string
  conversationId: string
  inReplyToUserId: string
  inReplyToUsername: string
  isPinned: boolean
  author: Author
  extendedEntities?: ExtendedEntities
  card: Record<string, any>
  place: Record<string, any>
  entities?: TweetEntities
  isRetweet: boolean
  isQuote: boolean
  isConversationControlled: boolean
  quoted_tweet: TweetInfo | null
  retweeted_tweet: TweetInfo | null
}

interface TweetArticleInfo {
  id: string
  author: Author
  replyCount: number
  likeCount: number
  quoteCount: number
  viewCount: number
  createdAt: string
  title: string
  preview_text: string
  cover_media_img_url: string
  contents: ArticleContentBlock[]
}

export type BlockType = 'unstyled' | 'header-one' | 'header-two' | 'unordered-list-item' | 'ordered-list-item' | 'image'

export type InlineStyle = 'Bold' | 'Italic' | 'Underline' | 'Code'

export interface InlineStyleRange {
  offset: number
  length: number
  style: InlineStyle
}

export interface TextBlock {
  type: Exclude<BlockType, 'image'>
  text: string
  inlineStyleRanges?: InlineStyleRange[]
}

export interface ImageBlock {
  type: 'image'
  url: string
  width: number
  height: number
}

export type ArticleContentBlock = TextBlock | ImageBlock

interface Author {
  type: string
  userName: string
  url: string
  twitterUrl: string
  id: string
  name: string
  isVerified: boolean
  isBlueVerified: boolean
  profilePicture: string
  coverPicture: string
  description: string
  location: string
  followers: number
  following: number
  status: string
  canDm: boolean
  canMediaTag: boolean
  createdAt: string
  entities: AuthorEntities
  fastFollowersCount: number
  favouritesCount: number
  hasCustomTimelines: boolean
  isTranslator: boolean
  mediaCount: number
  statusesCount: number
  withheldInCountries: any[]
  affiliatesHighlightedLabel: Record<string, any>
  possiblySensitive: boolean
  pinnedTweetIds: string[]
  profile_bio: ProfileBio
  isAutomated: boolean
  automatedBy: any
}

interface AuthorEntities {
  description: {
    urls: UrlEntity[]
    user_mentions: UserMention[]
  }
}

interface ProfileBio {
  description: string
  entities: {
    description: {
      urls: UrlEntity[]
      user_mentions: UserMention[]
    }
  }
  withheld_in_countries: any[]
}

interface UrlEntity {
  display_url: string
  expanded_url: string
  indices: number[]
  url: string
}

interface UserMention {
  id_str: string
  indices: number[]
  name: string
  screen_name: string
}

interface TweetEntities {
  urls: UrlEntity[]
}

interface ExtendedEntities {
  media: MediaEntity[]
}

interface MediaEntity {
  allow_download_status: {
    allow_download: boolean
  }
  display_url: string
  expanded_url: string
  ext_media_availability: {
    status: string
  }
  features: MediaFeatures
  id_str: string
  indices: number[]
  media_key: string
  media_results: MediaResults
  media_url_https: string
  original_info: OriginalInfo
  sizes: MediaSizes
  type: string
  url: string
  video_info?: VideoInfo
}

interface VideoInfo {
  variants: Variant[]
}

interface Variant {
  url: string
}

interface MediaFeatures {
  large: MediaFaceRecognition
  orig: MediaFaceRecognition
}

interface MediaFaceRecognition {
  faces?: Face[]
}

interface Face {
  h: number
  w: number
  x: number
  y: number
}

interface MediaResults {
  id: string
  result: {
    __typename: string
    id: string
    media_key: string
  }
}

interface OriginalInfo {
  focus_rects: FocusRect[]
  height: number
  width: number
}

interface FocusRect {
  h: number
  w: number
  x: number
  y: number
}

interface MediaSizes {
  large: {
    h: number
    w: number
  }
}

interface TwitterMentionsAPIResponse {
  tweets: TweetInfo[]
  has_next_page: boolean
  next_cursor: string
  status: string
  message: string
}

export type {
  TwitterAPIResponse,
  TweetArticleAPIResponse,
  TweetInfo,
  TweetArticleInfo,
  Author,
  MediaEntity,
  ExtendedEntities,
  TweetEntities,
  AuthorEntities,
  UrlEntity,
  UserMention,
  TwitterMentionsAPIResponse
}
