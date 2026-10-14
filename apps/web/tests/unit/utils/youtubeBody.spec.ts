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

  it('no duplicate article: a body that holds it shows no block and no bar', () => {
    expect(youtubeArticleView({ isYoutube: true, bodyHasArticle: true, below: false })).toBe('none')
    expect(youtubeArticleView({ isYoutube: true, bodyHasArticle: true, below: true })).toBe('none')
    expect(youtubeArticleView({ isYoutube: false, bodyHasArticle: false, below: false })).toBe('none')
  })

  it('raw body: the status bar first; the old block below the body once the bar falls back', () => {
    expect(youtubeArticleView({ isYoutube: true, bodyHasArticle: false, below: false })).toBe('bar')
    expect(youtubeArticleView({ isYoutube: true, bodyHasArticle: false, below: true })).toBe('below')
  })
})
