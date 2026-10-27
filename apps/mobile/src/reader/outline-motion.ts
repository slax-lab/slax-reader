export type OutlineStatus = 'none' | 'hidden' | 'collapsed' | 'expanded'
export interface OutlineMotionStep {toValue: number; duration: number; delay?: number; linear?: boolean}
export type OutlineMotion = Record<'background' | 'expanded' | 'slide' | 'collapsed' | 'morph' | 'morphAlpha', OutlineMotionStep[]>

export function outlineMotion(from: OutlineStatus, to: OutlineStatus): OutlineMotion {
  const entering = to === 'expanded', collapsing = from === 'expanded' && to === 'collapsed', expanding = from === 'collapsed' && entering
  const showing = (from === 'hidden' || from === 'none') && entering, hiding = from === 'expanded' && to === 'hidden'
  return {
    background: [{toValue: entering ? .5 : 0, duration: 300}],
    expanded: [{toValue: entering ? 1 : 0, duration: expanding ? 180 : collapsing ? 120 : showing ? 250 : hiding ? 200 : 0, delay: expanding ? 380 : 0}],
    slide: [{toValue: entering || to === 'collapsed' ? 0 : 1, duration: showing ? 300 : hiding ? 250 : 0}],
    collapsed: [{toValue: to === 'collapsed' ? 1 : 0, duration: collapsing ? 150 : expanding ? 100 : 200, delay: collapsing ? 430 : 0}],
    morph: [{toValue: entering ? 1 : 0, duration: collapsing || expanding ? 380 : 0, delay: collapsing ? 100 : expanding ? 80 : 0}],
    morphAlpha: collapsing ? [{toValue: 1, duration: 0}, {toValue: 0, duration: 100, delay: 480, linear: true}]
      : expanding ? [{toValue: 1, duration: 60, linear: true}, {toValue: 0, duration: 100, delay: 400, linear: true}]
      : [{toValue: 0, duration: 0}],
  }
}

/** The track whose last step ends the transition, mirroring the source `transitionState.isIdle`. */
export function outlineSettleTrack(motion: OutlineMotion): {key: keyof OutlineMotion; duration: number} {
  let settle: {key: keyof OutlineMotion; duration: number} = {key: 'background', duration: -1}
  for (const key of Object.keys(motion) as (keyof OutlineMotion)[]) {
    const duration = motion[key].reduce((total, step) => total + (step.delay ?? 0) + step.duration, 0)
    if (duration > settle.duration) settle = {key, duration}
  }
  return settle
}
