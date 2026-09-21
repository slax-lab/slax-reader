const isValidId = (id: string) => {
  const regex = /^[a-zA-Z][a-zA-Z0-9._-]*$/
  return regex.test(id)
}

// 将以数字开头的非法 ID/Class 选择器降级为属性选择器，避免 querySelector 抛出 SyntaxError
export const fixCssSelector = (selector: string): string => {
  const regex = /(\[[^\]]+\])|#(\d[-\w]*)|\.((\d[-\w]*))/g
  return selector.replace(regex, (match, attrNode, idMatch, _fullClassMatch, classMatch) => {
    if (attrNode) return match
    if (idMatch) return `[id="${idMatch}"]`
    if (classMatch) return `[class~="${classMatch}"]`
    return match
  })
}

export const getElementFullSelector = (element: HTMLElement, ignoreEles?: string[], baseParentEle?: Element) => {
  if (!element.ownerDocument.defaultView) {
    return ''
  }

  if (!(element instanceof element.ownerDocument.defaultView.Element)) {
    return ''
  }

  const path = []
  while (element && element.tagName) {
    let selector = element.tagName.toLowerCase()

    if (baseParentEle === element) {
      break
    }

    if (!ignoreEles || !ignoreEles.includes(selector)) {
      if (element.id && isValidId(element.id)) {
        selector += `#${element.id}`
      } else {
        const siblings = Array.from(element.parentNode?.children || []).filter(sibling => sibling.tagName === element.tagName)
        if (siblings.length > 1) {
          selector += `:nth-of-type(${Array.prototype.indexOf.call(siblings, element) + 1})`
        }
      }

      path.unshift(selector)
    } else {
      path.unshift('')
    }

    element = element.parentNode as HTMLElement
  }

  let haveIgnore = false
  const pathSelector = path.reduce((prev, cur) => {
    if (prev.length === 0) {
      return `${cur}`
    }

    if (cur.length === 0) {
      haveIgnore = true
    }

    if (cur.length > 0) {
      if (haveIgnore) {
        haveIgnore = false
        return `${prev} ${cur}`
      }

      return `${prev} > ${cur}`
    } else {
      haveIgnore = true
      return prev
    }
  }, '')

  return pathSelector.trim()
}

export const getNodeXPath = (node: Node) => {
  if (node.nodeType === Node.DOCUMENT_NODE) return ''

  const parts: string[] = []
  let current: Node | null = node
  while (current && current.nodeType !== Node.DOCUMENT_NODE) {
    let part = ''
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element
      part = element.tagName.toLowerCase()
      if (element.id) {
        part += `[@id="${element.id}"]`
      } else {
        let index = 1
        let sibling = element.previousElementSibling
        while (sibling) {
          if (sibling.tagName === element.tagName) index++
          sibling = sibling.previousElementSibling
        }
        if (index > 1) part += `[${index}]`
      }
    } else if (current.nodeType === Node.TEXT_NODE) {
      if (current.textContent && current.textContent.trim().length > 0) {
        let index = 1
        let sibling = current.previousSibling
        while (sibling) {
          if (sibling.nodeType === Node.TEXT_NODE && sibling.textContent && sibling.textContent.trim().length > 0) {
            index++
          }
          sibling = sibling.previousSibling
        }
        part = `text()[${index}]`
      }
    }
    if (part) {
      parts.unshift(part)
    }
    current = current.parentNode
  }

  return '/' + parts.join('/')
}

export const removeOuterTag = (dom: Element) => {
  const parentNode = dom.parentNode
  if (!parentNode) {
    return
  }

  while (dom.firstChild) {
    parentNode.insertBefore(dom.firstChild, dom)
  }

  parentNode.removeChild(dom)
}

export const getElementOwnerDocument = (el: HTMLElement): Document => {
  if (el.ownerDocument) {
    return el.ownerDocument
  }

  let node: Node | null = el
  while (node && node.parentNode) {
    node = node.parentNode
  }

  if (node && node.nodeType === Node.DOCUMENT_NODE) {
    return node as Document
  }

  return document
}

export const getElementOwnerWindow = (el: HTMLElement): Window => {
  const doc = getElementOwnerDocument(el)
  return doc.defaultView || window
}

export const createStyleWithSearchRules = async (searchRules: string[]) => {
  const styleElement = document.createElement('style')

  if (!searchRules || searchRules.length === 0) {
    return styleElement
  }

  const injectStyles = Array.from(document.styleSheets).filter(sheet => {
    try {
      return (
        sheet.cssRules.length > 0 &&
        Array.from(sheet.cssRules).some(rule =>
          searchRules.some(item => {
            return rule.cssText.includes(item)
          })
        )
      )
    } catch (e) {
      return false
    }
  })

  for (const style of injectStyles) {
    try {
      if (style.ownerNode && style.ownerNode.textContent) {
        styleElement.textContent += style.ownerNode.textContent + '\n'
      } else {
        const link = style.ownerNode as HTMLLinkElement

        let success = false
        try {
          const response = await fetch(link.href)
          const cssText = await response.text()
          styleElement.textContent += cssText + '\n'

          success = true
        } finally {
          if (!success) {
            for (let i = 0; i < style.cssRules.length; i++) {
              styleElement.textContent += (style.cssRules[i]?.cssText ?? '') + '\n'
            }
          }
        }
      }
    } catch (e) {}
  }

  return styleElement
}

// 避免选区带上尾部换行
export const trimRangeEnd = (range: Range, doc: Document = document): Range => {
  if (range.collapsed) return range

  const trimTextOffset = (text: string, offset: number): number => {
    while (offset > 0 && /\s/.test(text.charAt(offset - 1))) offset--
    return offset
  }

  if (range.endContainer.nodeType === Node.TEXT_NODE) {
    const endNode = range.endContainer as Text
    const trimmedOffset = trimTextOffset(endNode.data, range.endOffset)

    if (trimmedOffset > 0 || endNode === range.startContainer) {
      range.setEnd(endNode, trimmedOffset)
      return range
    }

    // 退到前一个非空白节点，同样需 trim 尾部
    const textNodes = getTextNodesInRange(range, doc)
    for (let i = textNodes.length - 1; i >= 0; i--) {
      if (textNodes[i] === endNode) continue
      const prevNode = textNodes[i] as Text
      range.setEnd(prevNode, trimTextOffset(prevNode.data, prevNode.data.length))
      return range
    }
  }

  return range
}

export const getTextNodesInRange = (range: Range, doc: Document = document): Node[] => {
  const nodes: Node[] = []

  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      if (!node.textContent || node.textContent.trim() === '') {
        return NodeFilter.FILTER_REJECT
      }

      const nodeRange = doc.createRange()
      nodeRange.selectNode(node)
      return range.compareBoundaryPoints(Range.END_TO_START, nodeRange) <= 0 && range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    }
  })

  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node.textContent && node.textContent.trim() !== '') {
      nodes.push(node)
    }
  }

  return nodes
}
