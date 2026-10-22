import { readerBookmarkUuid } from '@slax-reader/contracts'

// Capture external pages; Reader links are copied by the server from their authorized snapshot.
export const getWebSiteInfo = () => {
  const info: {
    target_url: string
    target_title: string
    target_icon: string
    description: string
    content: string
  } = {
    target_url: '',
    target_title: '',
    target_icon: '',
    description: '',
    content: ''
  }

  info.target_url = window.location.href
  info.target_title = document.title || document.querySelector('meta[property="og:title"]')?.getAttribute('content') || `${location.href}${location.pathname}`

  const iconLink = document.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')
  info.target_icon = iconLink ? iconLink.getAttribute('href') + '' : ''
  info.description =
    document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ||
    document.querySelector('meta[name="description"]')?.getAttribute('content') ||
    document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
    ''

  if (readerBookmarkUuid(info.target_url, [process.env.PUBLIC_BASE_URL])) return info

  const cloneDom = document.cloneNode(true) as Document
  Array.from(cloneDom.getElementsByTagName('slax-reader-modal') || []).forEach(element => element.remove())
  info.content = (cloneDom || document).documentElement.outerHTML

  return info
}
