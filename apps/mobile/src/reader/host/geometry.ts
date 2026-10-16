import type {ReaderGeometry} from '../coordinates.ts'

export interface ReaderHostViewport {offset: number; height: number}
export function readerHostGeometry(platform: 'ios' | 'android', input: {
  pixelRatio: number; headerHeight: number; headerSafeArea: number; screenTop: number; viewportHeight: number; scrollPoints: number
}, overrides?: Partial<ReaderGeometry>): ReaderGeometry {
  return {pixelRatio: input.pixelRatio, topInsetPoints: input.headerHeight,
    headerHeightPoints: platform === 'ios' ? Math.max(input.headerHeight - input.headerSafeArea, 0) : input.headerHeight,
    containerScreenTopPoints: input.screenTop,
    webViewScreenTopPoints: platform === 'android' ? input.screenTop + input.headerHeight - input.scrollPoints : input.screenTop,
    viewportHeightPoints: input.viewportHeight, ...overrides}
}
export function readerHostViewport(platform: 'ios' | 'android', rawOffset: number, viewportHeight: number, headerHeight: number): ReaderHostViewport {
  return {offset: platform === 'android' ? rawOffset - headerHeight : rawOffset, height: Math.max(0, viewportHeight)}
}
export function documentScrollToHost(platform: 'ios' | 'android', documentY: number, headerHeight: number, revealHeader = false): number {
  if (revealHeader) return platform === 'ios' ? -headerHeight : 0
  return platform === 'android' ? Math.max(0, headerHeight + documentY) : Math.max(0, documentY)
}
export function readerHostLayoutReady(platform: 'ios' | 'android', documentHeight: number, headerHeight: number, viewportHeight: number, contentHeight: number, pixelRatio: number): boolean {
  return documentHeight > 1 && viewportHeight > 0 && (platform === 'ios' || contentHeight + 1 / pixelRatio >= headerHeight + documentHeight)
}
