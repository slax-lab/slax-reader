import { readerAssets } from './embedded.generated.ts'
import {rewriteReaderImageTransports} from './image-transports.ts'

export interface ReaderDocumentOptions {
  pageId: string
  platform: 'android' | 'ios'
  rewriteImageTransports?: boolean
  /** Debug fixture commands require a validated native fixture cache scope. */
  controlledFixture?: boolean
  /** Gated debug observer only: passive counts without DOM commands or user data. */
  observeInput?: boolean
}

/** JSON is embedded as script source, never interpolated as a template literal. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

export function composeReaderDocument(html: string, options: ReaderDocumentOptions): string {
  const replacements: Record<string, string> = {
    '{{RESET-CSS}}': readerAssets.resetCss,
    '{{ARTICLE-CSS}}': readerAssets.articleCss,
    '{{MARK-CSS}}': readerAssets.markCss,
    '{{BOTTOM-LINE-CSS}}': readerAssets.bottomLineCss,
    '{{WEBVIEW-BRIGDE-JS}}': readerAssets.bridgeJs,
    '{{CONTENT}}': options.rewriteImageTransports === false ? html : rewriteReaderImageTransports(html),
  }
  // Single-pass substitution: a user's article may itself contain a template marker.
  const document = readerAssets.template.replace(/\{\{(?:RESET-CSS|ARTICLE-CSS|MARK-CSS|BOTTOM-LINE-CSS|WEBVIEW-BRIGDE-JS|CONTENT)\}\}/g,
    marker => replacements[marker]!)
  const host = readerAssets.nativeHostJs.replace('__SLAX_READER_CONFIGURATION__', scriptJson(options))
  return document.replace('<head>', `<head>\n<script>${host}</script>`)
}

export function composeReaderError(title: string, reason: string, detail: string): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
  const replacements: Record<string, string> = {
    '{{BACKGROUND}}': readerAssets.errorImageBase64,
    '{{TITLE}}': `<center>${escape(title)}</center>`, '{{REASON}}': `<center>${escape(reason)}</center>`, '{{DETAIL}}': `<center>${escape(detail)}</center>`,
  }
  return readerAssets.errorTemplate.replace(/\{\{(?:BACKGROUND|TITLE|REASON|DETAIL)\}\}/g, marker => replacements[marker]!)
}
