export interface TikHubRedditResponse {
  code: number
  message: string
  message_zh?: string
  data: { postsInfoByIds: RedditPost[] }
}

export interface RedditPost {
  __typename: string
  id: string
  createdAt: string
  editedAt: string | null
  postTitle: string
  url: string
  content: {
    markdown: string
    richtext: string
    html: string
    richtextMedia: any[]
    preview: string
  } | null
  domain: string
  isSpoiler: boolean
  isNsfw: boolean
  isLocked: boolean
  voteState: string
  score: number
  commentCount: number
  viewCount: number | null
  authorInfo: {
    __typename: string
    id: string
    name: string
    isBlocked: boolean
    isCakeDayNow: boolean
    newIcon: MediaSource | null
    iconSmall: MediaSource | null
    snoovatarIcon: MediaSource | null
    profile: {
      isNsfw: boolean
    }
    accountType: string
  }
  subreddit: {
    __typename: string
    id: string
    name: string
    prefixedName: string
    title: string
    type: string
    subscribersCount: number
    isNsfw: boolean
    styles: {
      icon: string | null
      legacyIcon: string | null
      primaryColor: string | null
      backgroundColor: string | null
      bannerBackgroundImage: string | null
    }
  }
  thumbnail: MediaSource | null
  media: RedditMedia | null
  permalink: string
  isArchived: boolean
  isStickied: boolean
  upvoteRatio: number
  languageCode: string
  isTranslatable: boolean
  gallery: RedditGallery | null
  outboundLink: {
    url: string
    expiresAt: string
  } | null
}

export interface MediaSource {
  __typename: string
  url: string
  dimensions: {
    width: number
    height: number
  }
}

export interface RedditMedia {
  __typename: string
  previewMediaId: string
  still: StillMedia | null
  obfuscated_still: StillMedia | null
  animated: any | null
  streaming: StreamingMedia | null
  video: any | null
  packagedMedia: any | null
  typeHint: string
  download: {
    __typename: string
    url: string
  } | null
}

export interface StillMedia {
  __typename: string
  source: MediaSource | null
  small: MediaSource | null
  medium: MediaSource | null
  large: MediaSource | null
  xlarge: MediaSource | null
  xxlarge: MediaSource | null
  xxxlarge: MediaSource | null
  altText: string | null
}

export interface StreamingMedia {
  __typename: string
  hlsUrl: string
  dashUrl: string
  scrubberMediaUrl: string
  dimensions: {
    width: number
    height: number
  }
  duration: number
  isGif: boolean
}

export interface RedditGallery {
  __typename: string
  media: GalleryMediaItem[]
}

export interface GalleryMediaItem {
  __typename: string
  id: string
  mediaType: string
  caption: string | null
  still: StillMedia
}

export interface RedditData {
  id: string
  title: string
  content: string
  contentHtml: string
  author: {
    name: string
    avatar: string | null
  }
  subreddit: {
    name: string
    title: string
    icon: string | null
  }
  createdAt: string
  score: number
  commentCount: number
  url: string
  permalink: string
  media: {
    type: 'image' | 'video' | 'gallery' | 'link' | 'text'
    images?: string[]
    videoUrl?: string
    thumbnail?: string
  }
}
