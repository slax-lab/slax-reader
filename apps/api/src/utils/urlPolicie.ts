import { deploymentOrigin } from './deploymentOrigin'

export enum parserType {
  UNKNOWN = 0,
  CLIENT_PARSE = 1,
  SERVER_FETCH_PARSE = 2,
  SERVER_PUPPETEER_PARSE = 3,
  BLOCK_PARSE = 4,
  URL_SHORTCUT = 5
}

export class URLPolicie {
  private _src: URL
  private parseType?: parserType
  private urlRegexRule: Record<string, parserType> = {
    'https://(r|reader).slax.(dev|com)/s/[a-zA-Z0-9]+': parserType.URL_SHORTCUT
  }
  private hostRegexRule: Record<string, parserType> = {
    '(.*.||)(dafahao|minghui|dongtaiwang|epochtimes|ntdtv|falundafa|wujieliulan).(org|com|net|dev)': parserType.BLOCK_PARSE,
    'r.slax.(dev|com)': parserType.BLOCK_PARSE,
    'r-beta.slax.(dev|com)': parserType.BLOCK_PARSE
  }

  constructor(
    private env: Env,
    src: URL | string
  ) {
    if (typeof src === 'string') {
      this._src = new URL(src)
    } else {
      this._src = src
    }
  }

  private initURLPolicie() {
    if (this._src.origin === deploymentOrigin(this.env.FRONT_END_URL)) {
      if (/^\/s\/[a-zA-Z0-9]+\/?$/.test(this._src.pathname)) {
        this.parseType = parserType.URL_SHORTCUT
        return
      }
      if (this.env.RUN_ENV === 'prod') {
        this.parseType = parserType.BLOCK_PARSE
        return
      }
    }
    if (this.env.RUN_ENV !== 'prod') {
      const u = this._src.toString()
      if (u.includes('localhost') && new RegExp('.*/s/[a-zA-Z0-9]+').test(u)) {
        this.parseType = parserType.URL_SHORTCUT
      } else {
        this.parseType = parserType.CLIENT_PARSE
      }
      return
    }
    for (const [k, v] of Object.entries(this.urlRegexRule)) {
      if (!this._src.toString().match(new RegExp(k))) continue
      this.parseType = v
      return
    }
    for (const [k, v] of Object.entries(this.hostRegexRule)) {
      if (!this._src.host.match(new RegExp(k))) continue
      this.parseType = v
      return
    }
    this.parseType = parserType.CLIENT_PARSE
  }

  private isTargetType(t: parserType): boolean {
    if (!this.parseType) this.initURLPolicie()
    return this.parseType === t
  }

  public isBlocked(): boolean {
    return this.isTargetType(parserType.BLOCK_PARSE)
  }

  public isClientParse(): boolean {
    return this.isTargetType(parserType.CLIENT_PARSE)
  }

  public isServerParse(): boolean {
    return this.isTargetType(parserType.SERVER_FETCH_PARSE) || this.isTargetType(parserType.SERVER_PUPPETEER_PARSE)
  }

  public isUrlShortcut(): boolean {
    return this.isTargetType(parserType.URL_SHORTCUT)
  }

  public getParserType(): parserType {
    if (!this.parseType) this.initURLPolicie()
    return this.parseType || parserType.UNKNOWN
  }
}

const PreparseHost: Map<string, (u: URL) => string> = new Map([
  [
    'x.com',
    (u: URL) => {
      u.searchParams.forEach((value, key) => u.searchParams.delete(key))
      return u.toString()
    }
  ],
  [
    'twitter.com',
    (u: URL) => {
      u.searchParams.forEach((value, key) => u.searchParams.delete(key))
      return u.toString()
    }
  ],
  [
    'mp.weixin.qq.com',
    (u: URL) => {
      u.searchParams.delete('poc_token')
      return u.toString()
    }
  ]
])

export const processTargetUrl = (targetUrl: URL) => {
  let processedUrl = targetUrl.toString()
  const preFunc = PreparseHost.get(targetUrl.host)
  if (preFunc) {
    processedUrl = preFunc(targetUrl).toString()
  }
  return processedUrl
}
