import { clearPendingSkill, readSkillStamp, writeSkillStamp } from './skillscheck.js'
import { execNpx } from './exec.js'
import { SKILL_INSTALL_ARGS, SKILL_SYNC_MANUAL_HINT } from './skillSource.js'

export type SkillSyncAction = 'in_sync' | 'synced' | 'failed'

export interface SkillSyncResult {
  action: SkillSyncAction
  current: string
  error?: string
  hint?: string
}

interface SkillSyncOptions {
  force?: boolean
}

export async function syncSkillToVersion(currentVersion: string, opts: SkillSyncOptions = {}): Promise<SkillSyncResult> {
  let stamp: string
  try {
    stamp = (await readSkillStamp()) ?? ''
  } catch (err) {
    return {
      action: 'failed',
      current: currentVersion,
      error: errorMessage(err),
      hint: SKILL_SYNC_MANUAL_HINT,
    }
  }

  if (!opts.force && stamp === currentVersion) {
    clearPendingSkill()
    return { action: 'in_sync', current: currentVersion }
  }

  try {
    await execNpx(SKILL_INSTALL_ARGS, {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    })
    await writeSkillStamp(currentVersion)
    clearPendingSkill()
    return { action: 'synced', current: currentVersion }
  } catch (err) {
    return {
      action: 'failed',
      current: currentVersion,
      error: errorMessage(err),
      hint: SKILL_SYNC_MANUAL_HINT,
    }
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'An unknown error occurred.'
}
