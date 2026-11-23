const twitterArticleHandler = (url: URL, document: Document) => {
  const testid = document.querySelector('[data-testid="twitter-article-title"]')
  if (!testid || !testid.textContent) return

  document.title = testid.textContent
}

export { twitterArticleHandler }

function removeThreadFooter(document: Document, threadLink: Element) {
  const lineBreak = threadLink.previousElementSibling
  const metrics = lineBreak?.localName === 'br' ? lineBreak.previousElementSibling : lineBreak
  let boundary = threadLink
  if (metrics?.localName === 'p' && metrics.textContent?.includes('💬') && metrics.textContent.includes('👁')) {
    boundary = metrics
    // The provider repeats og:description after a rule, sometimes followed by replies.
    let start = metrics.previousElementSibling
    while (start?.localName === 'p' && start.previousElementSibling?.localName !== 'hr') start = start.previousElementSibling
    const description = document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim()
    if (description && start?.textContent?.trim() === description && start.previousElementSibling?.localName === 'hr') boundary = start.previousElementSibling
  }
  while (boundary.nextSibling) boundary.nextSibling.remove()
  boundary.remove()
}

// Only a provider profile with a matching set of thread links delimits the authored body.
function findFxPreview(document: Document, article: Element) {
  const source = document.querySelector('meta[property="og:url"]')?.getAttribute('content')
  const author = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
  const heading = article.querySelector(':scope > sub:first-child + h1')
  if (!source || !author || !/\(@[a-z0-9_]+\)$/i.test(author) || heading?.textContent?.trim() !== author) return
  if (heading.previousElementSibling?.querySelector('a')?.getAttribute('href') !== source) return
  const last = article.lastElementChild
  if (last?.localName !== 'a' || last.getAttribute('href') !== source) return
  for (const profile of [...article.querySelectorAll(':scope > a + hr + h2')].reverse()) {
    const threadLink = profile.previousElementSibling?.previousElementSibling
    if (profile.textContent?.trim() === 'About author' && profile.nextElementSibling?.localName === 'img' && threadLink?.getAttribute('href') === source) {
      return { heading, threadLink }
    }
  }
}

export function prepareFxArticle(document: Document) {
  const article = document.querySelector('article')
  if (!article) return { usable: false }
  const clone = article.cloneNode(true) as Element
  for (const node of clone.querySelectorAll('script, style, noscript, template')) node.remove()
  const preview = findFxPreview(document, clone)
  let cover: Element | undefined
  if (preview) {
    const { heading, threadLink } = preview
    const image = heading.nextElementSibling
    const src = image?.getAttribute('src') || ''
    if (image?.localName === 'img' && /^https:\/\/pbs\.(?:fxtwitter|twimg)\.com\/media\//i.test(src)) {
      cover = image
      cover.remove()
    }
    heading.previousElementSibling!.remove()
    heading.remove()
    removeThreadFooter(document, threadLink)
  }

  const media = 'img[src], video[src], video source[src], audio[src], audio source[src], iframe[src]'
  const usable = Boolean(clone.textContent?.trim() || [...clone.querySelectorAll(media)].some(node => node.getAttribute('src')?.trim()))
  if (!preview || !usable) return { usable }
  const title = cover?.getAttribute('alt')?.trim()
  if (cover) clone.insertBefore(cover, clone.firstChild)
  clone.insertBefore(preview.heading, clone.firstChild)
  article.replaceWith(clone)
  return { usable, preview: true, title }
}
