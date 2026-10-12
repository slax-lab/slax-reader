import { getPendingSkill } from './skillscheck.js'
import { getPendingUpgrade } from './version.js'

export function buildHints(): Record<string, unknown> | null {
  const hints: Record<string, unknown> = {}
  const upgrade = getPendingUpgrade()
  const skill = getPendingSkill()

  if (upgrade) hints.upgrade = upgrade
  if (skill) hints.skill = skill

  return Object.keys(hints).length > 0 ? hints : null
}
