/** Pinned Material3 drawer anchors: half distance or 400dp/s directional fling. */
export function drawerDestination(progress: number, velocity: number): boolean {
  return Math.abs(velocity) >= 400 ? velocity > 0 : progress >= 0.5;
}

export function drawerProgress(start: number, translation: number, width: number): number {
  return Math.max(0, Math.min(1, start + translation / Math.max(1, width)));
}
