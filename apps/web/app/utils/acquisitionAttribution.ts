import type { AcquisitionAuthAttribution } from '@slax-reader/contracts/events'

export const acquisitionAttributionFromQuery = (query: Record<string, unknown>): AcquisitionAuthAttribution | undefined => {
  if (query.utm_source !== 'hackerlinks' || query.utm_campaign !== 'mvp') return undefined
  if (query.utm_medium !== 'header' && query.utm_medium !== 'resource_detail') return undefined
  return { source: 'hackerlinks', campaign: 'mvp', medium: query.utm_medium }
}

export const acquisitionUtmQuery = (query: Record<string, unknown>): Record<string, string> => {
  const attribution = acquisitionAttributionFromQuery(query)
  return attribution ? { utm_source: attribution.source, utm_campaign: attribution.campaign, utm_medium: attribution.medium } : {}
}
