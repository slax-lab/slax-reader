import { readerAssets } from './embedded.generated.ts'
import {rewriteReaderImageTransports} from './image-transports.ts'
import {READER_CSP} from './security.ts'

export interface ReaderDocumentOptions {
  pageId: string
  platform: 'android' | 'ios'
  rewriteImageTransports?: boolean
  imageProxyOrigins?: string[]
  /** Debug fixture commands require a validated native fixture cache scope. */
  controlledFixture?: boolean
  /** Gated debug observer only: passive counts without DOM commands or user data. */
  observeInput?: boolean
}

/** JSON is embedded as script source, never interpolated as a template literal. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

const CONTENT_MARKER = '{{CONTENT}}'
const CONFIGURATION_MARKER = '__SLAX_READER_CONFIGURATION__'
const constantMarkers: Record<string, string> = {
  '{{RESET-CSS}}': readerAssets.resetCss,
  '{{ARTICLE-CSS}}': readerAssets.articleCss,
  '{{MARK-CSS}}': readerAssets.markCss,
  '{{BOTTOM-LINE-CSS}}': readerAssets.bottomLineCss,
  '{{WEBVIEW-BRIGDE-JS}}': readerAssets.bridgeJs,
}
// Built once per module: the article (and its own literal markers) is never re-scanned for template markers.
const [templateHead, ...templateTail] = readerAssets.template.split(CONTENT_MARKER)
  .map(part => part.replace(/\{\{(?:RESET-CSS|ARTICLE-CSS|MARK-CSS|BOTTOM-LINE-CSS|WEBVIEW-BRIGDE-JS)\}\}/g, marker => constantMarkers[marker]!))
const headAt = templateHead!.indexOf('<head>') + '<head>'.length
const configurationAt = readerAssets.nativeHostJs.indexOf(CONFIGURATION_MARKER)
const documentPrefix = `${templateHead!.slice(0, headAt)}<meta http-equiv="Content-Security-Policy" content="${READER_CSP}"><meta name="referrer" content="strict-origin-when-cross-origin">\n<script>${readerAssets.nativeHostJs.slice(0, configurationAt)}`
const documentHostSuffix = `${readerAssets.nativeHostJs.slice(configurationAt + CONFIGURATION_MARKER.length)}</script>${templateHead!.slice(headAt)}`

export function composeReaderDocument(html: string, options: ReaderDocumentOptions): string {
  const content = rewriteReaderImageTransports(html, undefined, options.imageProxyOrigins)
  return documentPrefix + scriptJson(options) + documentHostSuffix + content + templateTail.join(content)
}

export function composeReaderError(title: string, reason: string, detail: string): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
  const replacements: Record<string, string> = {
    '{{BACKGROUND}}': readerAssets.errorImageBase64,
    '{{TITLE}}': `<center>${escape(title)}</center>`, '{{REASON}}': `<center>${escape(reason)}</center>`, '{{DETAIL}}': `<center>${escape(detail)}</center>`,
  }
  return readerAssets.errorTemplate.replace(/\{\{(?:BACKGROUND|TITLE|REASON|DETAIL)\}\}/g, marker => replacements[marker]!)
}
