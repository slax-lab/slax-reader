const bowtiedbullHandler = (url: URL, document: Document) => {
  // 标题处理
  const h1List = document.querySelectorAll('.header-anchor-post')
  h1List.forEach(item => {
    if (item.childElementCount < 1) return
    const title = item.querySelector('strong')?.textContent || ''
    if (!title) return

    item.childNodes.forEach(child => {
      item.removeChild(child)
    })
    item.textContent = title
  })
}

export { bowtiedbullHandler }
