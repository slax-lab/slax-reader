// Paid analytics events relocated out of the OSS commons layer.
// Re-exports an extended AnalyticsEvent / WebAnalyticsEvent that union
// the upstream events with paid additions. Fork code that needs to emit
// or constrain a paid event should import from `@commons/types-pro`
// instead of `@commons/types/analytics`.

import type { AnalyticsEvent as BaseAnalyticsEvent, WebAnalyticsEvent as BaseWebAnalyticsEvent } from '@commons/types/analytics'

export interface SubscriptionViewEvent {
  event: 'subscription_view'
  presentation: 'dialog' | 'screen'
}

export type AnalyticsEvent = BaseAnalyticsEvent | SubscriptionViewEvent
export type WebAnalyticsEvent = BaseWebAnalyticsEvent | SubscriptionViewEvent

export type AnalyticsEventName = AnalyticsEvent['event']
export type AnalyticsEventParams<T extends AnalyticsEventName> = Extract<AnalyticsEvent, { event: T }>
export type AnalyticsTrackFn = <T extends AnalyticsEventName>(params: AnalyticsEventParams<T>) => void
