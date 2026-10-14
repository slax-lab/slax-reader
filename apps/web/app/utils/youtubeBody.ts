// YouTube bookmark body: whether it already holds the AI article, and where the article UI goes.

/** The backend writes the cleaned article into the body with this marker (same markup as the podcast article). */
export const youtubeBodyHasArticle = (content: string): boolean => /<article\b[^>]*\bdata-slax-derived="youtube-article"/.test(content)

/**
 * - 'none': not YouTube, or the body already is the article (no second copy, nothing folded)
 * - 'bar': the article is being made and will become the body; a slim status line above it
 * - 'below': the body keeps the raw transcript; the article shows below it, as before
 */
export const youtubeArticleView = (input: { isYoutube: boolean; bodyHasArticle: boolean; below: boolean }): 'none' | 'bar' | 'below' => {
  if (!input.isYoutube || input.bodyHasArticle) return 'none'
  return input.below ? 'below' : 'bar'
}
