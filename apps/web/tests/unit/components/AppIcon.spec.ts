import AppIcon from '~~/app/components/AppIcon.vue'

import { ICON_REGISTRY, resolveIcon, resolveTabIconKey, type RuntimeIcon } from '~~/app/icons/registry'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, describe, expect, it } from 'vitest'

const mutableRegistry = ICON_REGISTRY as unknown as Record<string, RuntimeIcon>
const provenance = { sourcePath: 'test', sourceCommit: 'test' }

const setTestIcon = (name: string, icon: RuntimeIcon) => {
  mutableRegistry[name] = icon
}

afterEach(() => {
  for (const name of Object.keys(mutableRegistry)) {
    if (name.startsWith('test.')) delete mutableRegistry[name]
  }
})

describe('AppIcon', () => {
  it('renders generated inline geometry with its default size and hidden accessibility output', () => {
    const wrapper = mountWithApp(AppIcon, { props: { name: 'bookmark.inbox' } })
    const svg = wrapper.get('svg')
    expect(svg.attributes('width')).toBe('18')
    expect(svg.attributes('height')).toBe('18')
    expect(svg.attributes('viewBox')).toBe('0 0 18 18')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.find('path').exists()).toBe(true)
  })

  it('preserves source-root paint and stroke attributes in generated geometry', () => {
    const wrapper = mountWithApp(AppIcon, { props: { name: 'empty.search' } })
    const presentationGroup = wrapper.get('svg > g')
    expect(presentationGroup.attributes('fill')).toBe('none')
    expect(presentationGroup.attributes('stroke')).toBe('currentColor')
    expect(presentationGroup.attributes('stroke-width')).toBe('1.5')
    expect(presentationGroup.attributes('stroke-linecap')).toBe('round')
  })

  it('honors an explicit size and rejects an unknown registry key', () => {
    const wrapper = mountWithApp(AppIcon, { props: { name: 'empty.search', size: 24 } })
    expect(wrapper.get('svg').attributes('width')).toBe('24')
    expect(() => resolveIcon('not.registered')).toThrow(/Unknown icon key/)
  })

  it('renders mask entries through a currentColor mask surface', () => {
    setTestIcon('test.mask', {
      kind: 'mask',
      source: '/mask.svg',
      viewBox: '0 0 24 24',
      defaultSize: 24,
      paint: 'mask-currentColor',
      accessibility: 'decorative',
      sourceHash: 'test',
      provenance
    })
    const wrapper = mountWithApp(AppIcon, { props: { name: 'test.mask', size: '1em' } })
    const surface = wrapper.get('span')
    expect(surface.attributes('aria-hidden')).toBe('true')
    expect(surface.attributes('style')).toContain('mask-image: url(/mask.svg)')
    expect(surface.attributes('style')).toContain('width: 1em')
  })

  it('renders brand and raster entries as fixed image content', () => {
    setTestIcon('test.brand', {
      kind: 'brand',
      source: '/brand.svg',
      intrinsicWidth: 32,
      intrinsicHeight: 32,
      defaultSize: 32,
      paint: 'fixed',
      accessibility: 'standalone',
      label: 'Slax',
      sourceHash: 'test',
      provenance
    })
    const wrapper = mountWithApp(AppIcon, { props: { name: 'test.brand' } })
    const image = wrapper.get('img')
    expect(image.attributes('src')).toBe('/brand.svg')
    expect(image.attributes('alt')).toBe('Slax')
  })

  it('preserves the intrinsic aspect ratio of non-square image entries', () => {
    setTestIcon('test.wide-brand', {
      kind: 'brand',
      source: '/wide-brand.svg',
      intrinsicWidth: 160,
      intrinsicHeight: 40,
      defaultSize: 32,
      paint: 'fixed',
      accessibility: 'decorative',
      sourceHash: 'test',
      provenance
    })
    const image = mountWithApp(AppIcon, { props: { name: 'test.wide-brand' } }).get('img')
    expect(image.attributes('style')).toContain('width: 32px')
    expect(image.attributes('style')).toContain('height: auto')
    expect(image.attributes('style')).toContain('aspect-ratio: 160 / 40')
  })

  it('requires a label for standalone icons and accepts a caller label', () => {
    setTestIcon('test.standalone', {
      kind: 'inline',
      source: 'standalone.svg',
      viewBox: '0 0 24 24',
      defaultSize: 24,
      paint: 'currentColor',
      accessibility: 'standalone',
      geometry: '<circle cx="12" cy="12" r="10"/>',
      sourceHash: 'test',
      provenance
    })
    expect(() => mountWithApp(AppIcon, { props: { name: 'test.standalone' } })).toThrow(/requires an accessible label/)
    const wrapper = mountWithApp(AppIcon, { props: { name: 'test.standalone', label: 'Status' } })
    expect(wrapper.get('svg').attributes('role')).toBe('img')
    expect(wrapper.get('svg').attributes('aria-label')).toBe('Status')
  })

  it('uses the registered semantic fallback for layered tab types', () => {
    expect(resolveTabIconKey('unknown-layer-tab')).toBe('bookmark.fallback')
    expect(resolveTabIconKey('unknown-layer-tab', { viewBox: '0 0 24 24', markup: '<path/>' })).toBe('bookmark.fallback')
    expect(resolveTabIconKey('unknown-layer-tab', 'empty.search')).toBe('empty.search')
  })
})
