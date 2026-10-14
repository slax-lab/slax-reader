// youtubeBody: whether the body already holds the AI article, and which article UI the page shows
import { youtubeArticleView, youtubeBodyHasArticle } from '~~/app/utils/youtubeBody'

import { describe, expect, it } from 'vitest'

describe('youtubeBody', () => {
  it('finds the article the backend writes into the body, not the raw transcript or a podcast article', () => {
    expect(youtubeBodyHasArticle('<div class="slax-yt"><article class="slax-pod-article" data-slax-derived="youtube-article" lang="en"></article></div>')).toBe(true)
    expect(youtubeBodyHasArticle('<div class="slax-yt"><div class="slax-yt-transcript"></div></div>')).toBe(false)
    expect(youtubeBodyHasArticle('<article class="slax-pod-article" data-slax-derived="podcast-article"></article>')).toBe(false)
    expect(youtubeBodyHasArticle('<p>data-slax-derived="youtube-article"</p>')).toBe(false)
  })

  it('the page decides from the status, not the body text: the bar for every YouTube bookmark, the block once the bar falls back', () => {
    expect(youtubeArticleView({ isYoutube: false, below: false })).toBe('none')
    expect(youtubeArticleView({ isYoutube: true, below: false })).toBe('bar')
    expect(youtubeArticleView({ isYoutube: true, below: true })).toBe('below')
  })
})
