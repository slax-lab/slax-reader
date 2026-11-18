import { cosineSimilarity, MMR_LAMBDA, mmrSelect, PREVIEW_MEMBERS, ZORRO_CANDIDATE_DECAY_PER_HOUR } from './recommendationAlgorithms'

export { DISCOVERY_MEMBER_WINDOW as TRACE_MEMBER_WINDOW } from './discoveryCards'

export interface TraceMember {
  uuid: string
  url: string
  vector?: number[]
  publishedAt: string | Date
}

function timeFactor(publishedAt: string | Date, now: number) {
  const ageHours = (now - new Date(publishedAt).getTime()) / 3_600_000
  const freshness = Number.isFinite(ageHours) && ageHours >= 0 ? Math.exp(-ZORRO_CANDIDATE_DECAY_PER_HOUR * ageHours) : 0
  return 0.9 + 0.1 * freshness
}

export function rankDiscoveryMembers<T extends TraceMember>(members: T[], preference: number[], now: number, freshness = true) {
  const eligible = members
    .flatMap(member => {
      if (!member.vector) return []
      const affinity = cosineSimilarity(preference, member.vector)
      if (affinity <= 0) return []
      const sim1 = affinity * (freshness ? timeFactor(member.publishedAt, now) : 1)
      return [{ item: member, vector: member.vector, sim1 }]
    })
    .sort((a, b) => b.sim1 - a.sim1)
  const urls = new Set<string>()
  const candidates = eligible.filter(({ item }) => {
    if (urls.has(item.url)) return false
    urls.add(item.url)
    return true
  })
  const scores = new Map(candidates.map(candidate => [candidate.item, candidate.sim1]))
  const picked = mmrSelect(candidates, PREVIEW_MEMBERS, MMR_LAMBDA)
  const ordered = [...new Set([...picked, ...scores.keys()])]
  for (const member of members) {
    if (urls.has(member.url)) continue
    urls.add(member.url)
    ordered.push(member)
  }
  return ordered.map(member => ({ member, relevance: scores.get(member) ?? 0 }))
}

export function compareDiscoveryMembers(members: TraceMember[], preference: number[], subscription: number[], now: number) {
  const preview = (signal: number[], freshness: boolean) =>
    rankDiscoveryMembers(members, signal, now, freshness)
      .slice(0, PREVIEW_MEMBERS)
      .map(({ member }) => member.uuid)
  return {
    ranked: preview(preference, true),
    without_freshness: preview(preference, false),
    using_subscriptions: preview(subscription, true),
    candidates: members.map(member => ({
      id: member.uuid,
      interest: member.vector ? cosineSimilarity(preference, member.vector) : null,
      subscription: member.vector ? cosineSimilarity(subscription, member.vector) : null,
      time_factor: timeFactor(member.publishedAt, now)
    }))
  }
}
