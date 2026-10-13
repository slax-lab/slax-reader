import semver from 'semver'
import { isCI, isReleaseVersion } from './env.js'
import { readJsonState, writeJsonState } from './state.js'

const PACKAGE_NAME = '@slax-lab/reader-cli'
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`
const UPDATE_STATE_FILE = 'update-state.json'
const CACHE_TTL_MS = 60 * 1000 // 1 minute

interface UpdateState {
  latestVersion: string
  checkedAt: number
}

export interface UpgradeHint {
  current: string
  latest: string
  message: string
}

let pendingUpgrade: UpgradeHint | null = null
let refreshStarted = false

export async function getLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

export function isNewer(current: string, latest: string): boolean {
  return Boolean(semver.valid(latest)) && (!semver.valid(current) || semver.gt(latest, current))
}

export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  const latest = await getLatestVersion()
  if (latest && isNewer(currentVersion, latest)) {
    return latest
  }
  return null
}

export async function initUpgradeCheck(currentVersion: string): Promise<void> {
  pendingUpgrade = null
  if (shouldSkipUpgrade(currentVersion)) return

  try {
    const state = await readJsonState<UpdateState>(UPDATE_STATE_FILE)
    if (state?.latestVersion && isNewer(currentVersion, state.latestVersion)) {
      setPendingUpgrade(currentVersion, state.latestVersion)
    }
    if (!state || Date.now() - state.checkedAt >= CACHE_TTL_MS) {
      refreshUpgradeCache(currentVersion)
    }
  } catch {
    refreshUpgradeCache(currentVersion)
  }
}

export function getPendingUpgrade(): UpgradeHint | null {
  return pendingUpgrade
}

function setPendingUpgrade(current: string, latest: string): void {
  pendingUpgrade = {
    current,
    latest,
    message: `reader-cli ${latest} available, current ${current}, run: reader-cli upgrade`,
  }
}

function shouldSkipUpgrade(currentVersion: string): boolean {
  return Boolean(process.env.SLAX_NO_UPDATE_NOTIFIER) || isCI() || !isReleaseVersion(currentVersion)
}

function refreshUpgradeCache(currentVersion: string): void {
  if (refreshStarted) return
  refreshStarted = true
  void (async () => {
    try {
      const latest = await getLatestVersion()
      if (!latest) return
      await writeJsonState(UPDATE_STATE_FILE, {
        latestVersion: latest,
        checkedAt: Date.now(),
      } satisfies UpdateState)
      if (!pendingUpgrade && isNewer(currentVersion, latest)) {
        setPendingUpgrade(currentVersion, latest)
      }
    } catch {
      // Update hints are best-effort and must never affect command execution.
    }
  })()
}
