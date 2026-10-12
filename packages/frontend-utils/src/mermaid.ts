import DOMPurify from 'dompurify'

import { highlightBlock } from './parse'

type MermaidRenderResult = { svg: string } | { error: string }

const renderCache = new Map<string, MermaidRenderResult>()
const pendingRenders = new Map<string, Promise<MermaidRenderResult>>()

let renderIdSeed = 0

const loadMermaid = async () => {
  const { default: mermaid } = await import('mermaid')
  // htmlLabels: false keeps node labels in `<text>`/`<tspan>`, which the svg
  // sanitizer profile allows; HTML labels would need `<foreignObject>`, which
  // the profile strips (taking the label text with it) unless it is allowlisted
  // back in, and even then the `<br/>` line breaks inside a label are dropped.
  // suppressErrorRendering keeps a failed render from appending mermaid's error
  // diagram to the document body (and from leaving its temp elements behind).
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, suppressErrorRendering: true })
  return mermaid
}

let mermaidPromise: ReturnType<typeof loadMermaid> | null = null

const getMermaid = () => {
  // A rejected promise must not stay memoized: a transient chunk load failure
  // has to stay retryable for the rest of the session.
  mermaidPromise ??= loadMermaid().catch(error => {
    mermaidPromise = null
    throw error
  })
  return mermaidPromise
}

const sanitizeSvg = (svg: string) => DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const defaultErrorNoticeText = (errorMessage: string) => `Mermaid diagram failed to render: ${errorMessage}`

const renderMermaidSource = (source: string): Promise<MermaidRenderResult> => {
  const cached = renderCache.get(source)
  if (cached) return Promise.resolve(cached)

  const inFlight = pendingRenders.get(source)
  if (inFlight) return inFlight

  const renderPromise = renderUncachedSource(source)
  pendingRenders.set(source, renderPromise)
  return renderPromise
}

// A failed chunk load is transient and stays out of the cache so the next
// hydration retries it; a diagram the model got wrong is not transient, and its
// fallback is cached to stay stable across the streaming frames that re-hydrate.
const renderUncachedSource = async (source: string): Promise<MermaidRenderResult> => {
  try {
    let mermaid: Awaited<ReturnType<typeof loadMermaid>>
    try {
      mermaid = await getMermaid()
    } catch (error) {
      return { error: toErrorMessage(error) }
    }

    renderIdSeed += 1
    const renderId = `mermaid-diagram-${renderIdSeed}`

    let result: MermaidRenderResult
    try {
      const { svg } = await mermaid.render(renderId, source)
      result = { svg: sanitizeSvg(svg) }
    } catch (error) {
      result = { error: toErrorMessage(error) }
    }

    renderCache.set(source, result)
    return result
  } catch (error) {
    return { error: toErrorMessage(error) }
  } finally {
    pendingRenders.delete(source)
  }
}

const buildFallbackElement = (source: string, message: string, errorNoticeText: (errorMessage: string) => string) => {
  const wrapper = document.createElement('div')
  wrapper.className = 'mermaid-fallback'
  wrapper.innerHTML = `<div class="mermaid-error-notice"></div>${highlightBlock('', 'mermaid')}`

  const notice = wrapper.querySelector('.mermaid-error-notice')
  if (notice) notice.textContent = errorNoticeText(message)

  const code = wrapper.querySelector('code')
  if (code) code.textContent = source

  return wrapper
}

export interface HydrateMermaidOptions {
  errorNoticeText?: (errorMessage: string) => string
}

export const hydrateMermaidDiagrams = async (rootEl: HTMLElement, options: HydrateMermaidOptions = {}): Promise<void> => {
  const { errorNoticeText = defaultErrorNoticeText } = options
  const placeholders = Array.from(rootEl.querySelectorAll<HTMLElement>('.mermaid-placeholder'))

  for (const placeholder of placeholders) {
    if (placeholder.dataset.mermaidState) continue
    placeholder.dataset.mermaidState = 'pending'

    // markdown-it wraps any highlight output that does not start with `<pre` in
    // `<pre><code class="language-mermaid">`, so the placeholder sits inside a
    // code block. That wrapper is replaced along with the placeholder, keeping
    // the diagram out of the code-block styling and the failure fallback code
    // block out of a nested `<pre>`.
    const host = placeholder.closest('pre') ?? placeholder
    const source = placeholder.textContent ?? ''
    const result = await renderMermaidSource(source)

    if ('svg' in result) {
      const diagram = document.createElement('div')
      diagram.className = 'mermaid-diagram'
      diagram.innerHTML = result.svg
      host.replaceWith(diagram)
    } else {
      host.replaceWith(buildFallbackElement(source, result.error, errorNoticeText))
    }
  }
}
