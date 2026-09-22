import Defuddle from 'defuddle/full'
import { parseHTML } from 'linkedom'

function getDocument(src: string): Document {
  const { document } = parseHTML(src)
  return document
}

export function defuddleParse(url: string, document: Document) {
  const window = (document as any).defaultView || (document as any).ownerDocument?.defaultView

  if (!document.URL && url) {
    Object.defineProperty(document, 'URL', {
      value: url,
      writable: false,
      configurable: true
    })
  }

  if (!document.location && url) {
    try {
      const parsedUrl = new URL(url)
      Object.defineProperty(document, 'location', {
        value: {
          href: url,
          protocol: parsedUrl.protocol,
          host: parsedUrl.host,
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          pathname: parsedUrl.pathname,
          search: parsedUrl.search,
          hash: parsedUrl.hash,
          origin: parsedUrl.origin
        },
        writable: false,
        configurable: true
      })
    } catch (e) {}
  }

  if (!document.styleSheets || typeof (document.styleSheets as any)[Symbol.iterator] !== 'function') {
    Object.defineProperty(document, 'styleSheets', {
      value: [],
      writable: false,
      configurable: true
    })
  }

  if (window && !window.getComputedStyle) {
    window.getComputedStyle = function (element: Element, pseudoElement?: string | null) {
      const htmlElement = element as HTMLElement
      const inlineStyle = htmlElement.style || {}

      const getPropertyValue = (prop: string): string => {
        const normalizedProp = prop.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())

        // Check inline style first
        if (inlineStyle && (inlineStyle as any)[normalizedProp]) {
          return (inlineStyle as any)[normalizedProp]
        }
        if (inlineStyle && (inlineStyle as any)[prop]) {
          return (inlineStyle as any)[prop]
        }

        const defaults: Record<string, string> = {
          display: 'block',
          visibility: 'visible',
          opacity: '1',
          position: 'static',
          float: 'none',
          width: 'auto',
          height: 'auto'
        }
        return defaults[prop] || ''
      }

      const computedStyle: any = {
        getPropertyValue,
        length: 0,
        [Symbol.iterator]: function* () {},
        item: () => '',
        setProperty: () => {},
        removeProperty: () => '',
        getPropertyPriority: () => ''
      }

      const commonProps = ['display', 'visibility', 'opacity', 'position', 'float', 'width', 'height']
      commonProps.forEach(prop => {
        Object.defineProperty(computedStyle, prop, {
          get: () => getPropertyValue(prop),
          enumerable: true
        })
      })

      return computedStyle
    }
  }

  if (window && !window.matchMedia) {
    window.matchMedia = function (query: string) {
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      } as any
    }
  }

  const ensureOffsetDimensions = (doc: Document) => {
    const elements = doc.querySelectorAll('*')
    elements.forEach((el: any) => {
      if (typeof el.offsetWidth === 'undefined') {
        Object.defineProperty(el, 'offsetWidth', { value: 100, writable: false })
      }
      if (typeof el.offsetHeight === 'undefined') {
        Object.defineProperty(el, 'offsetHeight', { value: 100, writable: false })
      }
      if (typeof el.clientWidth === 'undefined') {
        Object.defineProperty(el, 'clientWidth', { value: 100, writable: false })
      }
      if (typeof el.clientHeight === 'undefined') {
        Object.defineProperty(el, 'clientHeight', { value: 100, writable: false })
      }
    })
  }

  try {
    ensureOffsetDimensions(document)
  } catch (e) {}

  const defuddle = new Defuddle(document, {
    debug: false,
    removeSmallImages: false,
    includeReplies: 'extractors',
    useAsync: false
  })
  const result = defuddle.parse()

  const doc = getDocument(`<html><body>${result.content}</body></html>` || '')
  const text = doc.body?.textContent?.replaceAll('\n', '\\n') || ''
  console.log(text)

  return {
    title: result.title,
    content: result.content,
    byline: result.author,
    textContent: text,
    length: result.wordCount,
    publishedTime: result.published,
    excerpt: '',
    siteName: result.site,
    lang: '',
    dir: ''
  }
}
