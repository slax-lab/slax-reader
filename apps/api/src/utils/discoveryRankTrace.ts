import { cosineSimilarity, MMR_LAMBDA, mmrSelect, PREVIEW_MEMBERS, ZORRO_CANDIDATE_DECAY_PER_HOUR } from './recommendationAlgorithms'

export const TRACE_MEMBER_WINDOW = 12
const FRESHNESS_WEIGHT = 0.1

export interface TraceMember {
  uuid: string
  url: string
  vector?: number[]
  publishedAt: string | Date
}

export function compareDiscoveryMembers(members: TraceMember[], preference: number[], subscription: number[], now: number) {
  const scores = members.map(member => {
    const ageHours = (now - new Date(member.publishedAt).getTime()) / 3_600_000
    const freshness = Number.isFinite(ageHours) && ageHours >= 0 ? Math.exp(-ZORRO_CANDIDATE_DECAY_PER_HOUR * ageHours) : 0
    return {
      member,
      interest: member.vector ? cosineSimilarity(preference, member.vector) : null,
      subscription: member.vector ? cosineSimilarity(subscription, member.vector) : null,
      timeFactor: 1 - FRESHNESS_WEIGHT + FRESHNESS_WEIGHT * freshness
    }
  })

  function select(signal: 'interest' | 'subscription', applyFreshness: boolean) {
    const ranked = scores
      .flatMap(score => {
        const affinity = score[signal]
        if (!score.member.vector || affinity === null || affinity <= 0) return []
        return [{ item: score.member, vector: score.member.vector, sim1: affinity * (applyFreshness ? score.timeFactor : 1) }]
      })
      .sort((a, b) => b.sim1 - a.sim1)
    const urls = new Set<string>()
    const unique = ranked.filter(({ item }) => {
      if (urls.has(item.url)) return false
      urls.add(item.url)
      return true
    })
    const picked = mmrSelect(unique, PREVIEW_MEMBERS, MMR_LAMBDA)
    for (const member of members) {
      if (picked.length === PREVIEW_MEMBERS) break
      if (urls.has(member.url)) continue
      urls.add(member.url)
      picked.push(member)
    }
    return picked.map(member => member.uuid)
  }

  return {
    ranked: select('interest', true),
    without_freshness: select('interest', false),
    using_subscriptions: select('subscription', true),
    candidates: scores.map(({ member, interest, subscription, timeFactor }) => ({
      id: member.uuid,
      interest,
      subscription,
      time_factor: timeFactor
    }))
  }
}
