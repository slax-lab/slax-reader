import { hashMD5 } from './strings'

export class Imager {
  private url!: URL
  constructor(private env: Env) {}

  private getImageUrlFromDocment(element: Element): string | null {
    function buildImageUrl(this: Imager, src: string | null): string {
      if (!src) return ''

      // 微信公众号的图片需要再拼接下webp格式，否则原图巨大
      if (src.startsWith('http') || (src.startsWith('https') && this.url?.host === 'mp.weixin.qq.com')) {
        const imgUrl = new URL(src)
        if (imgUrl.host != 'mmbiz.qpic.cn') return src
        imgUrl.searchParams.set('tp', 'webp')
        imgUrl.searchParams.set('wxfrom', '5')
        return imgUrl.href
      }

      // 喜闻乐见的直链 e.g. http://1.jpg
      if (src.startsWith('http') || src.startsWith('https')) return src

      // 缺省协议 e.g. //www.baidu.com/1.jpg
      if (src.startsWith('//')) return new URL(src, this.url).href

      // 相对路径图片 e.g. /1.jpg
      if (src.startsWith('/')) return new URL(src, this.url).href

      // base64 e.g. data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAPCAYAAADkmO9VAAABrElEQVRIDbXVvUoDQRQH8N
      if (src.startsWith('data:image/')) return src

      // 非顶级相对路径 e.g. ../../../../../../../../../../../../1.jpg
      if (src.startsWith('..') && this.url) return new URL(src, this.url).href

      // e.g. static/home/saoyisao.png
      return new URL(src, this.url).href
    }
    const url = this.url?.host === 'mp.weixin.qq.com' ? (element.getAttribute('data-src') ?? element.getAttribute('src')) : element.getAttribute('src')
    return buildImageUrl.call(this, url)
  }

  private async replaceItemImage(element: Element) {
    let imgUrl = this.getImageUrlFromDocment(element)
    if (!imgUrl || imgUrl.startsWith('data:')) return

    const proxyUrl = await this.buildImageUrl(imgUrl, this.url.href)
    element.setAttribute('src', proxyUrl)
  }

  private async replaceVideoImage(element: Element) {
    const poster = element.getAttribute('poster')
    if (poster) {
      const proxyUrl = await this.buildImageUrl(poster, this.url.href)
      element.setAttribute('poster', proxyUrl)
    }

    const src = element.getAttribute('src')
    if (src) {
      const proxySrc = await this.buildImageUrl(src, this.url.href)
      element.setAttribute('src', proxySrc)
    }
  }

  private async buildImageUrl(url: string, referer: string) {
    const proxyUrl = new URL(this.env.PROXY_IMAGE_PREFIX)
    const encodeUrl = encodeURIComponent(url)
    proxyUrl.searchParams.set('u', encodeUrl)
    proxyUrl.searchParams.set('r', referer)
    proxyUrl.searchParams.set('d', await hashMD5(encodeUrl + referer + this.env.IMAGER_CHECK_DIGST_SALT))
    return proxyUrl.href
  }

  private async replaceWeixinVideoImage(element: Element) {
    // Note: 由于视频号的图片过期时间非常快，10分钟左右就失效了
    // 所以此处提前缓存一下
    const avatarUrl = element.getAttribute('data-headimgurl') || ''
    if (avatarUrl) {
      const avatarImgUrl = await this.buildImageUrl(avatarUrl, this.url.href)
      element.setAttribute('data-headimgurl', avatarImgUrl)
      await fetch(avatarImgUrl)
    }
    const coverUrl = element.getAttribute('data-url') || ''
    if (coverUrl) {
      const coverImgUrl = await this.buildImageUrl(coverUrl, this.url.href)
      element.setAttribute('data-url', coverImgUrl)
      await fetch(coverImgUrl)
    }
  }

  /**
   * 批量替换图片为代理地址
   * @param imgs
   * @param header
   */
  public batchReplaceImage(url: URL, contentDocument: Document) {
    this.url = url

    const replacePromise = Array.from(contentDocument.querySelectorAll('img')).map(img => this.replaceItemImage(img))
    const replaceVideoPromise = Array.from(contentDocument.querySelectorAll('video')).map(video => this.replaceVideoImage(video))
    const replaceWeixinVideoPromise = Array.from(contentDocument.querySelectorAll('mp-common-videosnap')).map(video => this.replaceWeixinVideoImage(video))
    console.log(`start replace image: ${replacePromise.length}, video: ${replaceVideoPromise.length}, weixinVideo: ${replaceWeixinVideoPromise.length}`)
    return Promise.allSettled([...replacePromise, ...replaceVideoPromise, ...replaceWeixinVideoPromise])
  }

  /**
   * 替换 <head> 头 中的图片为代理地址
   * @param url
   * @param contentDocument
   */
  public replaceHeadImage(url: URL, contentDocument: Document) {
    this.url = url

    const elements = [
      ...Array.from(contentDocument.querySelectorAll('meta[property="og:image"]') || []),
      ...Array.from(contentDocument.querySelectorAll('meta[property="twitter:image"]') || []),
      ...Array.from(contentDocument.querySelectorAll('link[rel="apple-touch-icon"]') || [])
    ]

    const metaPromises = elements.map(element => {
      return (async () => {
        const attributeKeyRefs: Record<string, string> = {
          meta: 'content',
          link: 'href'
        }

        const attributeKey = attributeKeyRefs[element.tagName.toLowerCase()]
        if (!attributeKey) return null

        const src = element.getAttribute(attributeKey)
        if (!src) return null

        const imgUrl = this.getImageUrlFromDocment(element)
        if (!imgUrl || imgUrl.startsWith('data:')) return null

        const proxyUrl = await this.buildImageUrl(imgUrl, this.url.href)
        element.setAttribute(attributeKey, proxyUrl)
        return imgUrl
      })()
    })

    return Promise.allSettled(metaPromises)
  }
}

export const getImageProxyHeaders = (url: string, referer: string, rawHeader: Headers) => {
  const uUrl = new URL(url)
  if (uUrl.host === 'img-blog.csdnimg.cn') referer = ''
  return {
    Referer: referer,
    Accept: rawHeader.get('Accept') || 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': rawHeader.get('Accept-Language') || 'zh-CN,zh;q=0.9',
    'Accept-Encoding': rawHeader.get('Accept-Encoding') || 'br, gzip',
    'User-Agent': rawHeader.get('User-Agent') || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  }
}
