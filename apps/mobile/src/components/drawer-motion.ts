/** Pinned Material3 drawer anchors: half distance or 400dp/s directional fling. */
export function drawerDestination(progress: number, velocity: number): boolean {
  'worklet';
  return Math.abs(velocity) >= 400 ? velocity > 0 : progress >= 0.5;
}

export function drawerProgress(start: number, translation: number, width: number): number {
  'worklet';
  return Math.max(0, Math.min(1, start + translation / Math.max(1, width)));
}

/** KMP edge detector widths: 32pt on iOS, Material3 50dp on Android. */
export function drawerEdgeWidth(platform: string): number {
  return platform === 'ios' ? 32 : 50;
}

/** Closed: leading edge only, rightward activation and immediate leftward failure. Open: the full surface. */
export function drawerPanConfig(platform: string, open: boolean) {
  const slop = platform === 'ios' ? 10 : 8;
  const failOffsetY: [number, number] = [-slop, slop];
  return open
    ? {activeOffsetX: [-slop, slop] as [number, number], failOffsetY}
    : {hitSlop: {left: 0, width: drawerEdgeWidth(platform)}, activeOffsetX: platform === 'ios' ? 5 : 20, failOffsetX: -1, failOffsetY};
}
