import { GENERATED_ICON_REGISTRY } from './registry.generated'

export const ICON_KINDS = ['inline', 'mask', 'brand', 'raster'] as const
export type IconKind = (typeof ICON_KINDS)[number]

export const ICON_ACCESSIBILITY_MODES = ['decorative', 'control-labelled', 'standalone'] as const
export type IconAccessibility = (typeof ICON_ACCESSIBILITY_MODES)[number]

export type IconPaint = 'currentColor' | 'fixed' | 'mask-currentColor'
export type IconKey = keyof typeof GENERATED_ICON_REGISTRY
interface BaseRuntimeIcon {
  source: string
  defaultSize: number
  accessibility: IconAccessibility
  label?: string
  sourceHash: string
  provenance: {
    sourcePath: string
    sourceCommit: string
  }
}

export type RuntimeIcon =
  | (BaseRuntimeIcon & {
      kind: 'inline'
      viewBox: string
      paint: 'currentColor' | 'fixed'
      geometry: string
    })
  | (BaseRuntimeIcon & {
      kind: 'mask'
      viewBox: string
      paint: 'mask-currentColor'
    })
  | (BaseRuntimeIcon & {
      kind: 'brand' | 'raster'
      intrinsicWidth: number
      intrinsicHeight: number
      paint: 'fixed'
    })

export const ICON_REGISTRY = GENERATED_ICON_REGISTRY as Record<IconKey, RuntimeIcon>

export const hasIcon = (name: string): name is IconKey => Object.prototype.hasOwnProperty.call(ICON_REGISTRY, name)

export const resolveIcon = (name: string): RuntimeIcon => {
  if (!hasIcon(name)) {
    throw new Error(`[AppIcon] Unknown icon key: ${name}`)
  }
  return ICON_REGISTRY[name]
}

const TAB_ICON_KEYS: Record<string, IconKey> = {
  inbox: 'bookmark.inbox',
  starred: 'bookmark.starred',
  topics: 'bookmark.topics',
  collections: 'bookmark.collections',
  highlights: 'bookmark.highlights',
  archive: 'bookmark.archive',
  rss: 'bookmark.rss',
  trashed: 'bookmark.trash'
}

export const resolveTabIconKey = (type: string, configured?: unknown): IconKey => {
  if (typeof configured === 'string' && hasIcon(configured)) return configured
  return TAB_ICON_KEYS[type] ?? 'bookmark.fallback'
}
