import { beforeEach, describe, expect, it, vi } from 'vitest'

// happy-dom drops the outermost node of every DOMPurify pass, so a rendered
// <svg> root could never be observed through the real sanitizer. It is stubbed
// to identity here and its contract is asserted directly instead.
const { sanitizeMock, initializeMock, renderMock } = vi.hoisted(() => ({
  sanitizeMock: vi.fn((input: string) => input),
  initializeMock: vi.fn(),
  renderMock: vi.fn(async (id: string) => ({ svg: `<svg data-diagram-id="${id}"><text>diagram</text></svg>` }))
}))

vi.mock('dompurify', () => ({
  default: { sanitize: sanitizeMock }
}))

vi.mock('mermaid', () => ({
  default: { initialize: initializeMock, render: renderMock }
}))

// Each case needs its own module state: the render cache and the single mermaid
// initialization live at module scope.
type Hydrate = (typeof import('@commons/frontend-utils/mermaid'))['hydrateMermaidDiagrams']

const loadHydrate = async (): Promise<Hydrate> => {
  vi.resetModules()
  const module = await import('@commons/frontend-utils/mermaid')
  return module.hydrateMermaidDiagrams
}

const mountPlaceholder = (source: string) => {
  const root = document.createElement('div')
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  const placeholder = document.createElement('div')

  code.className = 'language-mermaid'
  placeholder.className = 'mermaid-placeholder'
  placeholder.textContent = source

  code.append(placeholder)
  pre.append(code)
  root.append(pre)

  return { root, pre, placeholder }
}

const mountBarePlaceholder = (source: string) => {
  const root = document.createElement('div')
  const placeholder = document.createElement('div')
  placeholder.className = 'mermaid-placeholder'
  placeholder.textContent = source
  root.append(placeholder)
  return { root, placeholder }
}

describe('hydrateMermaidDiagrams', () => {
  beforeEach(() => {
    initializeMock.mockClear()
    renderMock.mockClear()
    sanitizeMock.mockClear()
  })

  it('replaces the code block holding the placeholder with the sanitized svg', async () => {
    const hydrate = await loadHydrate()
    const { root, pre, placeholder } = mountPlaceholder('graph TD;\nA-->B;')

    await hydrate(root)

    expect(pre.isConnected).toBe(false)
    expect(placeholder.isConnected).toBe(false)
    expect(root.querySelector('pre, code')).toBeNull()
    expect(root.children).toHaveLength(1)

    const diagram = root.querySelector('.mermaid-diagram')
    expect(diagram?.querySelector('svg text')?.textContent).toBe('diagram')
    // The svg profile alone: labels stay in `<text>`/`<tspan>` because mermaid
    // renders with htmlLabels disabled, so no tag has to be allowlisted back in.
    expect(sanitizeMock).toHaveBeenCalledWith(expect.stringContaining('<svg'), { USE_PROFILES: { svg: true, svgFilters: true } })
  })

  it('replaces a bare placeholder that no code block wraps', async () => {
    const hydrate = await loadHydrate()
    const { root, placeholder } = mountBarePlaceholder('graph TD;\nC-->D;')

    await hydrate(root)

    expect(placeholder.isConnected).toBe(false)
    expect(root.children).toHaveLength(1)
    expect(root.querySelector('.mermaid-diagram')).not.toBeNull()
  })

  it('initializes mermaid with the strict security level, once per session', async () => {
    const hydrate = await loadHydrate()
    const first = mountPlaceholder('graph LR;\nA-->B;')
    await hydrate(first.root)

    expect(initializeMock).toHaveBeenCalledTimes(1)
    expect(initializeMock).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true
    })

    const second = mountPlaceholder('graph RL;\nC-->D;')
    await hydrate(second.root)

    expect(initializeMock).toHaveBeenCalledTimes(1)
  })

  it('retries a failed mermaid load instead of caching the failure', async () => {
    const hydrate = await loadHydrate()
    initializeMock.mockImplementationOnce(() => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    const source = 'graph TD;\nLoad-->Retry;'
    const first = mountPlaceholder(source)

    await hydrate(first.root)

    expect(renderMock).not.toHaveBeenCalled()
    expect(first.root.querySelector('.mermaid-error-notice')?.textContent).toBe(
      'Mermaid diagram failed to render: Failed to fetch dynamically imported module'
    )

    const second = mountPlaceholder(source)
    await hydrate(second.root)

    expect(initializeMock).toHaveBeenCalledTimes(2)
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(second.root.querySelector('.mermaid-diagram')).not.toBeNull()
  })

  it('renders a given source once and reuses the result', async () => {
    const hydrate = await loadHydrate()
    const source = 'sequenceDiagram\nA->>B: hello'
    const first = mountPlaceholder(source)
    await hydrate(first.root)

    const second = mountPlaceholder(source)
    await hydrate(second.root)
    await hydrate(second.root)

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(second.root.querySelector('.mermaid-diagram')).not.toBeNull()
  })

  it('de-duplicates concurrent hydration of the same source', async () => {
    const hydrate = await loadHydrate()
    const source = 'classDiagram\nA <|-- B'
    const first = mountPlaceholder(source)
    const second = mountPlaceholder(source)

    await Promise.all([hydrate(first.root), hydrate(second.root)])

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(first.root.querySelector('.mermaid-diagram')).not.toBeNull()
    expect(second.root.querySelector('.mermaid-diagram')).not.toBeNull()
  })

  it('falls back to a code block with an error notice when rendering fails', async () => {
    const hydrate = await loadHydrate()
    renderMock.mockRejectedValueOnce(new Error('Parse error on line 2'))
    const source = 'flowchart TD;\nB --> '
    const { root, pre, placeholder } = mountPlaceholder(source)

    await expect(hydrate(root)).resolves.toBeUndefined()

    expect(pre.isConnected).toBe(false)
    expect(placeholder.isConnected).toBe(false)
    expect(root.querySelector('.mermaid-placeholder')).toBeNull()
    expect(root.querySelector('code.language-mermaid')).toBeNull()
    expect(root.children).toHaveLength(1)

    const fallback = root.querySelector('.mermaid-fallback')
    expect(fallback?.querySelector('.mermaid-error-notice')?.textContent).toBe('Mermaid diagram failed to render: Parse error on line 2')
    expect(fallback?.querySelector('pre.code-block-wrapper code')?.textContent).toBe(source)
  })

  it('builds the error notice text through the caller provided formatter', async () => {
    const hydrate = await loadHydrate()
    renderMock.mockRejectedValueOnce(new Error('Parse error on line 2'))
    const source = 'flowchart TD;\nB --> '
    const { root } = mountPlaceholder(source)

    await hydrate(root, { errorNoticeText: errorMessage => `图表渲染失败：${errorMessage}` })

    expect(root.querySelector('.mermaid-error-notice')?.textContent).toBe('图表渲染失败：Parse error on line 2')
  })

  it('caches the failure so later hydrations reuse the fallback', async () => {
    const hydrate = await loadHydrate()
    renderMock.mockRejectedValueOnce(new Error('Unknown diagram type'))
    const source = 'notADiagram\n- item'
    const first = mountPlaceholder(source)
    await hydrate(first.root)

    const second = mountPlaceholder(source)
    await hydrate(second.root)

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(second.root.querySelector('.mermaid-error-notice')?.textContent).toContain('Unknown diagram type')
  })
})
