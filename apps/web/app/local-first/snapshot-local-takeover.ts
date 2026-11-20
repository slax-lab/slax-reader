// The deferred snapshot detail exposes local rows only to the verified owner, for the account it started with.
export interface SnapshotTakeoverFacts {
  isOwner: boolean
  startedGeneration: number
  currentGeneration: number
  tokenOwner: string | null
  databaseOwner: string | null
  existsLocally: () => Promise<boolean>
}

export async function canTakeOverSnapshotLocally(facts: () => SnapshotTakeoverFacts): Promise<boolean> {
  const before = facts()
  if (!isCurrentOwner(before)) return false
  let exists = false
  try {
    exists = await before.existsLocally()
  } catch {
    return false
  }
  // The account or the content response may change while the local lookup runs.
  return exists && isCurrentOwner(facts())
}

function isCurrentOwner(facts: SnapshotTakeoverFacts): boolean {
  return facts.isOwner && facts.startedGeneration === facts.currentGeneration && !!facts.tokenOwner && facts.databaseOwner === facts.tokenOwner
}
