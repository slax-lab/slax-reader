import { z } from 'zod'

// 共用的环境变量定义 Schema
const baseEnvSchema = z.object({
  PUBLIC_BASE_URL: z.string().startsWith('http'),
  AUTH_BASE_URL: z.string().startsWith('http'),
  COOKIE_DOMAIN: z.string(),
  COOKIE_TOKEN_NAME: z.string().min(5),
  SHARE_BASE_URL: z.string().startsWith('http')
})

// 插件环境变量 Schema
export const extensionsEnvSchema = baseEnvSchema.extend({
  EXTENSIONS_API_BASE_URL: z.string(),
  GOOGLE_ANALYTICS_MEASUREMENT_ID: z.string().optional(),
  GOOGLE_ANALYTICS_API_SECRET: z.string().optional(),
  UNINSTALL_FEEDBACK_URL: z.string().startsWith('http').optional()
})

// 网页环境变量 Schema（含 fork 专属的 Stripe 付费相关变量）
export const dwebEnvSchema = baseEnvSchema.extend({
  DWEB_API_BASE_URL: z.string().startsWith('http'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  APPLE_OAUTH_CLIENT_ID: z.string().optional(),
  TURNSTILE_SITE_KEY: z.string().optional(),
  PUSH_API_PUBLIC_KEY: z.string().optional(),
  GTM_CONTAINER_ID: z.string().optional(),
  // fork 专属：Stripe 付费相关变量
  STRIPE_ONCE_PRICE_ID: z.string().startsWith('price_').optional(),
  STRIPE_SUB_PRICE_ID: z.string().startsWith('price_').optional(),
  STRIPE_ONTIME_PRICE_ID: z.string().startsWith('price_').optional(),
  STRIPE_PUBLIC_KEY: z.string().startsWith('pk_').optional()
})
