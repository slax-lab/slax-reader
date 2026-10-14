const mediumHandler = (url: URL, document: Document) => {
  // a标签转换
  const aDoms = document.querySelectorAll('a[rel*="noopener"]')
  for (const element of aDoms) {
    let childCount = element.childElementCount || 0
    if (childCount < 1) continue
    childCount = element.children[0].childElementCount || 0
    if (childCount < 2) continue
    const title = element.querySelector('h2')?.textContent?.trim() || ''
    if (!title) continue

    const href = element.getAttribute('href')
    if (!href) continue

    const aUrl = new URL(href, url.href)
    if (!aUrl.href) continue

    element.textContent = title
    element.setAttribute('href', url.href)

    console.log('replace', title, element.getAttribute('href'))
    element.parentNode?.parentElement?.replaceChild(element, element.parentNode)
  }
  // 移除干扰内容
  document.querySelector('div[aria-labelledby="1"]')?.parentElement?.parentElement?.parentElement?.parentElement?.remove()
}

export { mediumHandler }
