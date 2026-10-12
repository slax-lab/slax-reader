// 获取网站基本信息
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

  const cloneDom = document.cloneNode(true) as Document
  Array.from(cloneDom.getElementsByTagName('slax-reader-modal') || []).forEach(element => element.remove())
  info.content = (cloneDom || document).documentElement.outerHTML

  return info
}
