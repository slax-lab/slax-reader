export interface RedditItem {
  id: string
  parsedId: string
  url: string
  username: string
  userId: string
  title: string
  communityName: string
  parsedCommunityName: string
  body: string
  html: string
  link: string
  numberOfComments: number
  flair: string
  upVotes: number
  upVoteRatio: number
  isVideo: boolean
  isAd: boolean
  over18: boolean
  thumbnailUrl: string
  createdAt: string
  scrapedAt: string
  dataType: string
}
