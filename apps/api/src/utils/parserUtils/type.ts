export type ParserHandlerFunc = (document: Document) => void

export type ParserName = 'readability' | 'defuddle'

export interface Preparse {
  title: string
  // HTML DOM
  contentDocument: Document
  // HTML CONTENT
  content: string
  // HTML ONLY TEXT
  textContent: string
  length: number
  excerpt: string
  byline: string
  dir: string
  siteName: string
  lang: string
  publishedTime: Date
}

export interface CustomParse {
  title: string
  // HTML DOM
  contentDocument: Document
  // HTML CONTENT
  content: string
  // HTML ONLY TEXT
  textContent: string
  length: number
  excerpt: string
  byline: string
  dir: string
  siteName: string
  lang: string
  publishedTime: string
}
