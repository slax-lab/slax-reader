import tokens from '../../styles/theme.tokens.css?raw'
import { appearancePath, denied, evictPublicReader, type OfflineArticle, publicReaderCache, type ReaderAppearance } from '../offline/public-reader'

const messages = {
  en: { saved: 'Offline · Saved copy', unavailable: 'This article is unavailable offline.', retry: 'Retry' },
  zh: { saved: '离线 · 已保存的副本', unavailable: '此文章暂时无法离线阅读。', retry: '重试' }
}

const escapeText = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function offlineDocument(article: OfflineArticle | undefined, appearance: ReaderAppearance) {
  const copy = messages[appearance.locale]
  const title = escapeText(article?.title || copy.unavailable)
  return new Response(`<!doctype html><html lang="${appearance.locale}" data-slax-theme="${appearance.theme}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>${tokens}
body{margin:0;background:var(--slax-bg);color:var(--slax-text);font:1rem/1.75 var(--slax-font-sans)}
main{max-width:46rem;margin:auto;padding:clamp(1rem,4vw,3rem);overflow-wrap:anywhere}
header{display:flex;flex-wrap:wrap;gap:1rem;align-items:center;color:var(--slax-text-muted)}
a{display:inline-flex;min-height:44px;align-items:center;color:var(--slax-link)}
a:focus-visible{outline:2px solid currentColor;outline-offset:2px}
h1{font-size:clamp(1.5rem,4vw,2.25rem);line-height:1.3}article{white-space:pre-wrap}</style></head>
<body><main><header>${article ? copy.saved : ''}<a href="">${copy.retry}</a></header><h1>${title}</h1>
${article ? '<article>' + escapeText(article.text) + '</article>' : ''}</main></body></html>`, {
    status: article ? 200 : 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    }
  })
}

export async function readerNavigation(request: Request, path: string) {
  const key = path.replace(/\/$/, '')
  let live: Response
  try {
    live = await fetch(request)
  } catch {
    const cache = await caches.open(publicReaderCache)
    let record = await cache.match(key)
    if (key.startsWith('/s/') && record) record = await cache.match(await record.json())
    const appearance = await cache.match(appearancePath)
    return offlineDocument(await record?.json(), appearance ? await appearance.json() : {
      locale: navigator.language.startsWith('zh') ? 'zh' : 'en', theme: 'light'
    })
  }
  if (denied(live.status)) {
    const cache = await caches.open(publicReaderCache)
    await evictPublicReader(cache, key)
  }
  return live
}
