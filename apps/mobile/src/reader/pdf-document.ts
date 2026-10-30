import {mobileColors} from '../theme/index.ts'
import {pdfCsp} from './pdf-types.ts'
import type {PdfDocumentOptions, PdfLabels} from './pdf-types.ts'
export type {PdfDocumentOptions, PdfLabels, PdfSelection, PdfReaderEvent, PdfMarkItem} from './pdf-types.ts'
export {PDF_ORIGIN, PDF_IOS_ORIGIN, pdfOrigin, pdfSourcePath} from './pdf-types.ts'

const defaults: PdfLabels = {page: 'Page', loading: 'Loading PDF…', error: 'Unable to display PDF', mark: 'Annotation'}
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!))

export function composePdfDocument(options: PdfDocumentOptions): string {
  const bundle = require('../../assets/pdf/bundle.json') as typeof import('../../assets/pdf/bundle.json')
  const labels = {...defaults, ...options.labels}
  if (!/^\/pdf\/[A-Za-z0-9_-]{1,240}\/[A-Za-z0-9_-]{1,256}\/[1-9][0-9]{0,15}$/.test(options.source)) throw new Error('Invalid PDF source')
  const nonce = `slax-pdf-${options.pageId.replace(/[^a-zA-Z0-9-]/g, '')}`
  const config = {...options, descriptor: {size: options.descriptor.size, document_id: options.descriptor.document_id, filename: options.descriptor.filename}, labels}
  const csp = pdfCsp(nonce, options.platform)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escape(options.descriptor.filename)}</title><style>
:root{color-scheme:only light;font:14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:${mobileColors.text};background:${mobileColors.readerBackground};--mark:${mobileColors.markStroke};--selection:${mobileColors.textSelection};caret-color:${mobileColors.textSelection.slice(0, 7)}}
*{box-sizing:border-box}body{margin:0}.mark-quad:focus-visible{outline:2px solid ${mobileColors.accent};outline-offset:2px}#pages{padding:8px;width:100%}.page{position:relative;margin:0 auto 12px;background:${mobileColors.surface};overflow:hidden;contain:layout paint;box-sizing:content-box}.page canvas{position:absolute;inset:0}.marks{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}.mark-quad{fill:var(--mark);fill-opacity:.28;stroke:var(--mark);stroke-width:.6;pointer-events:none}#status{padding:24px;text-align:center;color:${mobileColors.bodyText}}#status[role=status]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.textLayer{position:absolute;text-align:initial;inset:0;overflow:hidden;opacity:1;line-height:1;letter-spacing:normal;word-spacing:normal;-webkit-text-size-adjust:none;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;z-index:1;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor)*var(--min-font-size));--min-font-size-inv:calc(1/var(--min-font-size))}.textLayer :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;-webkit-user-select:text;user-select:text}.textLayer>:not(.markedContent),.textLayer .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor)*var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}.textLayer .markedContent{display:contents}.textLayer span[role=img]{user-select:none}.textLayer ::selection{background:var(--selection);color:transparent}.textLayer br::selection{background:transparent}
</style></head><body><div id="status" role="status">${escape(labels.loading)}</div><main id="pages"></main><script nonce="${nonce}">window.__SLAX_PDF_OPTIONS__=${json(config)};window.__SLAX_PDF_ASSETS__=${json({worker: bundle.worker, resources: bundle.resources})};</script><script nonce="${nonce}">${bundle.script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
}
