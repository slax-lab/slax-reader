export const motionDuration = {
  drawer: 220,
  rowSettle: 200,
  titlePulse: 180,
  sheetEnter: 220,
  sheetExit: 160,
} as const;

export function motionDurationFor(duration: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : duration;
}

/** A drawer settle covers only the distance left after a drag, so short completions finish proportionally sooner. */
export function drawerSettleDuration(from: number, to: number, base: number = motionDuration.drawer): number {
  'worklet';
  const remaining = Math.min(1, Math.abs(to - from));
  return remaining <= 0 ? 0 : Math.max(Math.min(base, 120), Math.round(base * remaining));
}
