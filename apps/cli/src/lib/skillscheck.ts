import { isCI, isReleaseVersion } from './env.js'
import { readTextState, writeTextState } from './state.js'

const STAMP_FILE = 'skills.stamp'

export interface SkillHint {
  current: string
  target: string
  message: string
}

let pendingSkill: SkillHint | null = null

export async function initSkillCheck(currentVersion: string): Promise<void> {
  pendingSkill = null
  if (shouldSkipSkillCheck(currentVersion)) return

  let stamp: string | null
  try {
    stamp = await readSkillStamp()
  } catch {
    return
  }

  const current = stamp ?? ''
  if (current === currentVersion) return

  pendingSkill = {
    current,
    target: currentVersion,
    message: current
      ? `reader-cli skill out of sync (${current} → ${currentVersion}), run: reader-cli upgrade`
      : `reader-cli skill not installed, run: reader-cli upgrade`,
  }
}

export async function readSkillStamp(): Promise<string | null> {
  return readTextState(STAMP_FILE)
}

export async function writeSkillStamp(version: string): Promise<void> {
  await writeTextState(STAMP_FILE, version)
}

export function getPendingSkill(): SkillHint | null {
  return pendingSkill
}

export function clearPendingSkill(): void {
  pendingSkill = null
}

function shouldSkipSkillCheck(currentVersion: string): boolean {
  return Boolean(process.env.SLAX_NO_SKILLS_NOTIFIER) || isCI() || !isReleaseVersion(currentVersion)
}
