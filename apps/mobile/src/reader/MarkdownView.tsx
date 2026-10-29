import type {NativeSyntheticEvent, NativeScrollEvent} from 'react-native'
import React, { useEffect, useRef, useState } from 'react'
import { PixelRatio } from 'react-native'
import { WebView } from 'react-native-webview'
import { scriptJson } from './document.ts'
import { IncrementalMarkdown } from './markdown.ts'
import { markdownDomScript } from './markdown-dom.ts'

const shell = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>
body{margin:0;padding:4px 20px 50px;color:#333;background:#fff;font-family:-apple-system,Roboto,Arial,sans-serif;font-size:15px;line-height:20px;overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{margin:16px 0 8px;color:#0f1419;font-weight:600}h1{font-size:20px;line-height:28px}h2{font-size:17px;line-height:22px}h3,h4,h5,h6{font-size:12px;line-height:16px}p{margin:8px 0}a{color:#4d4d4d;background:rgba(22,185,152,.12);font-size:12px;text-decoration:none;border-radius:2px}a:active{color:#333;background:rgba(22,185,152,.25)}ul,ol{margin:8px 0;padding-left:24px}li{margin:4px 0}li>p{margin:4px 0}code{font-family:ui-monospace,Menlo,monospace;font-size:14px;color:#e01e5a;background:#f5f5f5;border-radius:3px;padding:0 3px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:12px;border-radius:8px;margin:8px 0}pre code{font-size:13px;line-height:18px;color:#333;background:none;padding:0}blockquote{margin:8px 0;border-left:3px solid #e0e0e0;padding-left:12px;color:#666}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{padding:6px;border:1px solid #e0e0e0;text-align:left}hr{border:0;border-top:1px solid #e0e0e0;margin:16px 0}</style></head><body><main id="content"></main><script>
${markdownDomScript}
</script></body></html>`
const source = {html: shell, baseUrl: 'https://outline.slax.invalid'}

export function MarkdownView({markdown, initialPosition = 0, onLink, onPosition}: {markdown: string; initialPosition?: number; onLink(href: string): void; onPosition?(physicalPixels: number): void}) {
  const view = useRef<WebView<unknown>>(null)
  const [loaded, setLoaded] = useState(false)
  const restored = useRef(false)
  const restorePosition = useRef(initialPosition)
  const lastPosition = useRef<number | null>(null)
  const renderer = useRef<IncrementalMarkdown | null>(null)
  if (!renderer.current) renderer.current = new IncrementalMarkdown()
  restorePosition.current = initialPosition
  useEffect(() => {
    if (!loaded) return
    const frame = requestAnimationFrame(() => {
      const blocks = renderer.current!.update(markdown)
      const position = restorePosition.current / PixelRatio.get()
      view.current?.injectJavaScript(`window.__slaxOutlineUpdate(${scriptJson(blocks)});${!restored.current && blocks.length ? `window.scrollTo(0,${Number.isFinite(position) ? Math.max(0, position) : 0});` : ''}true;`)
      if (blocks.length) restored.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [markdown, loaded])
  return <WebView<unknown> ref={view} source={source} style={{flex: 1, backgroundColor: '#FFFFFF'}}
    onLoadEnd={() => setLoaded(true)} onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!restored.current) return
      const position = Math.max(0, Math.round(event.nativeEvent.contentOffset.y * PixelRatio.get()))
      if (!Number.isFinite(position) || position === lastPosition.current) return
      lastPosition.current = position
      onPosition?.(position)
    }} onMessage={event => {
      try { const message = JSON.parse(event.nativeEvent.data) as {type: string; href?: string}
        if (message.type === 'link' && typeof message.href === 'string') onLink(message.href)
      } catch { /* Ignore malformed messages from a retired document. */ }
    }} onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url === 'https://outline.slax.invalid/'}
    originWhitelist={['https://outline.slax.invalid', 'about:blank']} javaScriptEnabled showsVerticalScrollIndicator={false} automaticallyAdjustContentInsets={false} testID="reader-outline-markdown" />
}
