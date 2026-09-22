const githubPreHandler = (url: URL, document: Document) => {
  // 移除干扰内容
  document.querySelector('.AppHeader-localBar')?.remove()
  document.querySelector('table[aria-labelledby="folders-and-files"]')?.parentElement?.remove()
  document.querySelector('div[id="repos-file-tree"]')?.remove()
  document.querySelector('[data-testid="latest-commit"]')?.parentElement?.remove()
  document.querySelector('nav[aria-label="Repository files"]')?.parentElement?.remove()

  const markdownHeadings = Array.from(document.querySelectorAll('.markdown-heading'))
  markdownHeadings.forEach(container => {
    const heading = container.querySelector('h1, h2, h3, h4, h5, h6')
    if (heading) {
      const headingText = heading.textContent
      const newHeading = document.createElement(heading.tagName)
      newHeading.textContent = headingText
      container.parentNode?.replaceChild(newHeading, container)
    }
  })

  // 增加对代码块中类的保留
  const pres = Array.from(document.querySelectorAll('.markdown-body .highlight pre')) || []
  pres.forEach(pre => {
    if (pre.classList.contains('preserve-class-tag')) return

    pre.classList.add('preserve-class-tag')
  })
}

export { githubPreHandler }
