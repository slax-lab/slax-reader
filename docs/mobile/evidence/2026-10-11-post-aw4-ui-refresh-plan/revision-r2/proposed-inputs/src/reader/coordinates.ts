export interface ReaderGeometry {
  pixelRatio: number
  /** Actual native WKWebView top content inset; includes source article header and safe area. */
  topInsetPoints: number
  headerHeightPoints: number
  containerScreenTopPoints: number
  webViewScreenTopPoints: number
  viewportHeightPoints: number
}

function geometryCheck(geometry: ReaderGeometry): void {
  if (geometry.pixelRatio <= 0 || !Object.values(geometry).every(Number.isFinite)) throw new Error('Invalid reader geometry')
}

/** Legacy positions are physical pixels. React Native positions are logical points. */
export function legacyPositionToScrollPoints(platform: 'android' | 'ios', positionPixels: number, geometry: ReaderGeometry): number {
  geometryCheck(geometry)
  return platform === 'ios' ? positionPixels / geometry.pixelRatio - geometry.topInsetPoints : Math.max(positionPixels / geometry.pixelRatio, 0)
}

export function scrollPointsToLegacyPosition(platform: 'android' | 'ios', rawScrollPoints: number, geometry: ReaderGeometry): number {
  geometryCheck(geometry)
  return Math.max((rawScrollPoints + (platform === 'ios' ? geometry.topInsetPoints : 0)) * geometry.pixelRatio, 0)
}

export function anchorToScrollPoints(platform: 'android' | 'ios', documentY: number, geometry: ReaderGeometry): number {
  geometryCheck(geometry)
  return platform === 'android'
    ? Math.max(geometry.headerHeightPoints + documentY - geometry.viewportHeightPoints / 4, 0)
    : Math.max(documentY - geometry.topInsetPoints, 0)
}

export function selectionScreenYToContainerPoints(screenYPoints: number, geometry: ReaderGeometry): number {
  geometryCheck(geometry)
  return screenYPoints - geometry.containerScreenTopPoints
}

/** This reproduces source menu gap/height and clamping, with explicit point units. */
export function selectionMenuTop(touchYPoints: number, containerHeightPoints: number, minTopPoints: number): number {
  const menuHeight = 44
  const offset = touchYPoints < containerHeightPoints * 0.2 ? touchYPoints + 32 : touchYPoints - menuHeight - 32
  return Math.max(minTopPoints, Math.min(offset, Math.max(minTopPoints, containerHeightPoints - menuHeight)))
}

export function toolbarVisible(positionPixels: number, isNearBottom: boolean): boolean {
  return isNearBottom || positionPixels <= 10
}

/** Source iOS KVO reports offset plus inset before DetailScreen computes its 100dp bottom gap. */
export function readerNearBottom(platform: 'android' | 'ios', rawScrollPoints: number, contentHeightPoints: number, viewportHeightPoints: number, geometry: ReaderGeometry): boolean {
  geometryCheck(geometry)
  const scrollPoints = platform === 'ios' ? Math.max(rawScrollPoints + geometry.topInsetPoints, 0) : rawScrollPoints
  const distance = contentHeightPoints - (scrollPoints + viewportHeightPoints) + (platform === 'ios' ? geometry.headerHeightPoints : 0)
  return distance < 100
}
