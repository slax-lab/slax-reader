const twitterArticleHandler = (url: URL, document: Document) => {
  const testid = document.querySelector('[data-testid="twitter-article-title"]')
  if (!testid || !testid.textContent) return

  document.title = testid.textContent
}

export { twitterArticleHandler }
