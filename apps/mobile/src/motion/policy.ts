export const motionDuration = {
  drawer: 300,
  rowSettle: 200,
  titlePulse: 180,
  sheetEnter: 220,
  sheetExit: 160,
  contentReveal: 160,
} as const;

export function motionDurationFor(duration: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : duration;
}
