import { SubscriptionType, type UserInfo } from '@slax-reader/contracts/interface'
import type { PowerSyncDatabase } from '@powersync/web'

interface LocalUserRow {
  id: string
  email: string | null
  name: string | null
  picture: string | null
  lang: string | null
  timezone: string | null
}

interface LocalSubscriptionRow {
  subscribed: number | null // 0/1
  subscription_end_time: string | null // ISO 文本
}

export const loadLocalUserInfo = async (): Promise<UserInfo | null> => {
  if (!import.meta.client) return null
  const db = useNuxtApp().$powersync as PowerSyncDatabase | null
  if (!db) return null

  const row = await db.getOptional<LocalUserRow>('SELECT id, email, name, picture, lang, timezone FROM sr_user LIMIT 1')
  if (!row) return null

  const sub = await db.getOptional<LocalSubscriptionRow>('SELECT subscribed, subscription_end_time FROM sr_user_subscription LIMIT 1')
  const subscribed = sub?.subscribed === 1

  return {
    userId: Number(row.id) || 0,
    email: row.email ?? '',
    name: row.name ?? '',
    picture: row.picture ?? '',
    lang: row.lang ?? 'en',
    timezone: row.timezone ?? '',
    subscription_type: subscribed ? SubscriptionType.PAID_SUBSCRIPTION : SubscriptionType.NO_SUBSCRIPTION,
    subscription_end_at: sub?.subscription_end_time ? new Date(sub.subscription_end_time) : new Date(0)
  }
}
