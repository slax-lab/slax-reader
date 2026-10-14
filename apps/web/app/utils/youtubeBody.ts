// YouTube bookmark body: whether it already holds the AI article, and where the article UI goes.

/** The backend writes the cleaned article into the body with this marker (same markup as the podcast article). */
export const youtubeBodyHasArticle = (content: string): boolean => /<article\b[^>]*\bdata-slax-derived="youtube-article"/.test(content)

/**
 * - 'none': not YouTube
 * - 'bar': the status line above the body. It decides from the status (body_mode, body_ready), not
 *   from the body text: a body can hold the owner's article while this viewer gets another version.
 *   It shows nothing when the body already holds the viewer's article.
 * - 'below': the body is not the viewer's article (marks, another language, a failed write); the
 *   article shows below it, as before
 */
export const youtubeArticleView = (input: { isYoutube: boolean; below: boolean }): 'none' | 'bar' | 'below' => {
  if (!input.isYoutube) return 'none'
  return input.below ? 'below' : 'bar'
}
