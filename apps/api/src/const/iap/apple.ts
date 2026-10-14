/**
 * 环境类型
 */
export enum Environment {
  SANDBOX = 'Sandbox',
  PRODUCTION = 'Production'
}

/**
 * 通知类型 - Apple发送的所有通知类型
 */
export enum NotificationType {
  /** 用户消费了消耗型商品 */
  CONSUMPTION_REQUEST = 'CONSUMPTION_REQUEST',
  /** 用户完成了订阅的首次购买 */
  DID_CHANGE_RENEWAL_PREF = 'DID_CHANGE_RENEWAL_PREF',
  /** 用户更改了续订偏好 */
  DID_CHANGE_RENEWAL_STATUS = 'DID_CHANGE_RENEWAL_STATUS',
  /** 订阅续订失败 */
  DID_FAIL_TO_RENEW = 'DID_FAIL_TO_RENEW',
  /** 订阅成功续订 */
  DID_RENEW = 'DID_RENEW',
  /** 订阅已过期 */
  EXPIRED = 'EXPIRED',
  /** 宽限期已过期 */
  GRACE_PERIOD_EXPIRED = 'GRACE_PERIOD_EXPIRED',
  /** 用户兑换了优惠 */
  OFFER_REDEEMED = 'OFFER_REDEEMED',
  /** 价格上涨相关 */
  PRICE_INCREASE = 'PRICE_INCREASE',
  /** 退款完成 */
  REFUND = 'REFUND',
  /** 退款被拒绝 */
  REFUND_DECLINED = 'REFUND_DECLINED',
  /** 退款逆转(撤销) */
  REFUND_REVERSED = 'REFUND_REVERSED',
  /** 续订延期 */
  RENEWAL_EXTENDED = 'RENEWAL_EXTENDED',
  /** 续订延期请求 */
  RENEWAL_EXTENSION = 'RENEWAL_EXTENSION',
  /** 订阅被撤销 */
  REVOKE = 'REVOKE',
  /** 用户订阅了 */
  SUBSCRIBED = 'SUBSCRIBED',
  /** 测试通知 */
  TEST = 'TEST',
  /** 外部购买 */
  EXTERNAL_PURCHASE_TOKEN = 'EXTERNAL_PURCHASE_TOKEN',
  /** 一次性充值 */
  ONE_TIME_CHARGE = 'ONE_TIME_CHARGE'
}

/**
 * 通知子类型
 */
export enum NotificationSubtype {
  /** 初次购买 */
  INITIAL_BUY = 'INITIAL_BUY',
  /** 重新订阅 */
  RESUBSCRIBE = 'RESUBSCRIBE',
  /** 降级 */
  DOWNGRADE = 'DOWNGRADE',
  /** 升级 */
  UPGRADE = 'UPGRADE',
  /** 自动续订启用 */
  AUTO_RENEW_ENABLED = 'AUTO_RENEW_ENABLED',
  /** 自动续订禁用 */
  AUTO_RENEW_DISABLED = 'AUTO_RENEW_DISABLED',
  /** 自愿取消 */
  VOLUNTARY = 'VOLUNTARY',
  /** 计费重试 */
  BILLING_RETRY = 'BILLING_RETRY',
  /** 价格上涨 */
  PRICE_INCREASE = 'PRICE_INCREASE',
  /** 产品不可用 */
  PRODUCT_NOT_FOR_SALE = 'PRODUCT_NOT_FOR_SALE',
  /** 宽限期 */
  GRACE_PERIOD = 'GRACE_PERIOD',
  /** 待定 */
  PENDING = 'PENDING',
  /** 已接受 */
  ACCEPTED = 'ACCEPTED',
  /** 计费恢复 */
  BILLING_RECOVERY = 'BILLING_RECOVERY',
  /** 失败 */
  FAILURE = 'FAILURE',
  /** 汇总 */
  SUMMARY = 'SUMMARY',
  /** 未续订 */
  UNREPORTED = 'UNREPORTED'
}

/**
 * 交易类型
 */
export enum TransactionType {
  /** 自动续订订阅 */
  AUTO_RENEWABLE_SUBSCRIPTION = 'Auto-Renewable Subscription',
  /** 非消耗型 */
  NON_CONSUMABLE = 'Non-Consumable',
  /** 消耗型 */
  CONSUMABLE = 'Consumable',
  /** 非续订订阅 */
  NON_RENEWING_SUBSCRIPTION = 'Non-Renewing Subscription'
}

/**
 * 应用内所有权类型
 */
export enum InAppOwnershipType {
  /** 家庭共享 */
  FAMILY_SHARED = 'FAMILY_SHARED',
  /** 已购买 */
  PURCHASED = 'PURCHASED'
}

/**
 * 优惠类型
 */
export enum OfferType {
  /** 入门优惠 */
  INTRODUCTORY = 1,
  /** 促销优惠 */
  PROMOTIONAL = 2,
  /** 订阅优惠码 */
  SUBSCRIPTION_OFFER_CODE = 3,
  /** 赢回优惠 */
  WIN_BACK = 4
}

/**
 * 优惠折扣类型
 */
export enum OfferDiscountType {
  /** 免费试用 */
  FREE_TRIAL = 'FREE_TRIAL',
  /** 预付 */
  PAY_UP_FRONT = 'PAY_UP_FRONT',
  /** 按使用付费 */
  PAY_AS_YOU_GO = 'PAY_AS_YOU_GO'
}

/**
 * 自动续订状态
 */
export enum AutoRenewStatus {
  /** 关闭 */
  OFF = 0,
  /** 开启 */
  ON = 1
}

/**
 * 过期原因
 */
export enum ExpirationIntent {
  /** 用户取消 */
  CUSTOMER_CANCELLED = 1,
  /** 计费错误 */
  BILLING_ERROR = 2,
  /** 用户不同意价格上涨 */
  CUSTOMER_DID_NOT_CONSENT_TO_PRICE_INCREASE = 3,
  /** 产品不可用 */
  PRODUCT_NOT_AVAILABLE = 4,
  /** 其他原因 */
  OTHER = 5
}

/**
 * 价格上涨状态
 */
export enum PriceIncreaseStatus {
  /** 未响应 */
  CUSTOMER_HAS_NOT_RESPONDED = 0,
  /** 同意 */
  CUSTOMER_CONSENTED = 1
}

/**
 * 撤销原因
 */
export enum RevocationReason {
  /** 应用内的问题 */
  REFUNDED_DUE_TO_ISSUE = 1,
  /** 其他原因 */
  REFUNDED_FOR_OTHER_REASON = 0
}

/**
 * 交易原因
 */
export enum TransactionReason {
  /** 购买 */
  PURCHASE = 'PURCHASE',
  /** 续订 */
  RENEWAL = 'RENEWAL'
}

/**
 * Apple发送的原始请求体
 */
export interface ResponseBodyV2 {
  /** JWS格式的签名负载 */
  signedPayload: string
}

/**
 * 解密后的通知负载 (responseBodyV2DecodedPayload)
 */
export interface ResponseBodyV2DecodedPayload {
  /** 通知类型 */
  notificationType: NotificationType
  /** 通知子类型 (可选) */
  subtype?: NotificationSubtype
  /** 通知UUID */
  notificationUUID: string
  /** 通知版本 */
  version: string
  /** 签名日期 (Unix时间戳，毫秒) */
  signedDate: number
  /** 通知数据 */
  data?: NotificationData
  /** 汇总数据 (用于批量通知) */
  summary?: NotificationSummary
  /** 外部购买token */
  externalPurchaseToken?: ExternalPurchaseToken
}

/**
 * 通知数据
 */
export interface NotificationData {
  /** App Apple ID */
  appAppleId?: number
  /** Bundle ID */
  bundleId: string
  /** Bundle版本 */
  bundleVersion?: string
  /** 环境 */
  environment: Environment
  /** JWS格式的签名续订信息 */
  signedRenewalInfo?: string
  /** JWS格式的签名交易信息 */
  signedTransactionInfo?: string
  /** 状态 */
  status?: number
  /** 消费请求原因 */
  consumptionRequestReason?: string
}

/**
 * 通知汇总 (用于批量通知)
 */
export interface NotificationSummary {
  /** 请求标识符 */
  requestIdentifier: string
  /** 环境 */
  environment: Environment
  /** App Apple ID */
  appAppleId: number
  /** Bundle ID */
  bundleId: string
  /** 产品ID */
  productId: string
  /** 商店 */
  storefront: string
  /** 商店ID */
  storefrontId: string
  /** 成功次数 */
  succeededCount: number
  /** 失败次数 */
  failedCount: number
}

/**
 * 外部购买Token
 */
export interface ExternalPurchaseToken {
  /** 外部购买ID */
  externalPurchaseId: string
  /** Token创建日期 */
  tokenCreationDate: number
  /** App Apple ID */
  appAppleId: number
  /** Bundle ID */
  bundleId: string
}

/**
 * 解密后的交易信息 (JWSTransactionDecodedPayload)
 */
export interface JWSTransactionDecodedPayload {
  /** 交易ID */
  transactionId: string
  /** 原始交易ID */
  originalTransactionId: string
  /** Bundle ID */
  bundleId: string
  /** 产品ID */
  productId: string
  /** 购买日期 (Unix时间戳，毫秒) */
  purchaseDate: number
  /** 原始购买日期 (Unix时间戳，毫秒) */
  originalPurchaseDate: number
  /** 数量 */
  quantity: number
  /** 交易类型 */
  type: TransactionType
  /** App账户Token (UUID格式，可用于关联用户) */
  appAccountToken?: string
  /** 应用内所有权类型 */
  inAppOwnershipType?: InAppOwnershipType
  /** 签名日期 (Unix时间戳，毫秒) */
  signedDate: number
  /** 环境 */
  environment: Environment
  /** 交易原因 */
  transactionReason?: TransactionReason
  /** 商店 (三字母国家代码) */
  storefront?: string
  /** 商店ID */
  storefrontId?: string
  /** 价格 (以毫单位计) */
  price?: number
  /** 货币代码 (ISO 4217) */
  currency?: string

  // ====== 订阅相关字段 ======
  /** 过期日期 (Unix时间戳，毫秒) - 仅订阅 */
  expiresDate?: number
  /** 订阅组标识符 */
  subscriptionGroupIdentifier?: string
  /** Web订单行项目ID */
  webOrderLineItemId?: string
  /** 是否已升级 */
  isUpgraded?: boolean

  // ====== 优惠相关字段 ======
  /** 优惠类型 */
  offerType?: OfferType
  /** 优惠标识符 */
  offerIdentifier?: string
  /** 优惠折扣类型 */
  offerDiscountType?: OfferDiscountType
  /** 优惠期间 */
  offerPeriod?: string

  // ====== 撤销/退款相关字段 ======
  /** 撤销日期 (Unix时间戳，毫秒) */
  revocationDate?: number
  /** 撤销原因 */
  revocationReason?: RevocationReason

  // ====== 应用相关字段 ======
  /** App交易ID */
  appTransactionId?: string
}

/**
 * 解密后的续订信息 (JWSRenewalInfoDecodedPayload)
 */
export interface JWSRenewalInfoDecodedPayload {
  /** 原始交易ID */
  originalTransactionId: string
  /** 自动续订产品ID */
  autoRenewProductId: string
  /** 产品ID */
  productId: string
  /** 自动续订状态 */
  autoRenewStatus: AutoRenewStatus
  /** 签名日期 (Unix时间戳，毫秒) */
  signedDate: number
  /** 环境 */
  environment: Environment

  // ====== 过期相关字段 ======
  /** 过期原因 */
  expirationIntent?: ExpirationIntent
  /** 宽限期过期日期 (Unix时间戳，毫秒) */
  gracePeriodExpiresDate?: number
  /** 是否在计费重试期 */
  isInBillingRetryPeriod?: boolean

  // ====== 优惠相关字段 ======
  /** 优惠类型 */
  offerType?: OfferType
  /** 优惠标识符 */
  offerIdentifier?: string
  /** 优惠折扣类型 */
  offerDiscountType?: OfferDiscountType

  // ====== 价格相关字段 ======
  /** 价格上涨状态 */
  priceIncreaseStatus?: PriceIncreaseStatus
  /** 续订价格 (以毫单位计) */
  renewalPrice?: number
  /** 货币代码 */
  currency?: string

  // ====== 其他字段 ======
  /** 最近订阅开始日期 */
  recentSubscriptionStartDate?: number
  /** 续订日期 */
  renewalDate?: number
}
