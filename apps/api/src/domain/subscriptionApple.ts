import { ContextManager } from '@/utils/context'
import { inject, injectable } from '../decorators/di'
import { UserRepo } from '../infra/repository/dbUser'
import { SlaxAlertBotClient } from '../infra/external/slaxAlertBot'
import { AppleIAPProductMismatchError, ErrorParam, SubscriptionNotExpired, UserNotFoundError } from '@/const/err'
import { receiveActivityType, subscriptionInterval, SubscriptionRepo } from '../infra/repository/dbSubscription'
import { AppleJWSVerifier } from '@/utils/iap/apple'
import {
  ResponseBodyV2DecodedPayload,
  JWSTransactionDecodedPayload,
  JWSRenewalInfoDecodedPayload,
  NotificationType,
  AutoRenewStatus,
  Environment,
  OfferType,
  TransactionType
} from '@/const/iap/apple'
import * as jose from 'jose'
import { userInfoPO } from '@/infra/repository/dbUser'
import { addMonths, differenceInMonths, differenceInDays } from 'date-fns'
import { GA4AnalyticsClient } from '@/infra/external/ga4Analytics'
import { LogsService } from './logs'

interface AppleProductInfo {
  Monthly: string
  MonthlyTrial1Mo: string
  MonthlyTrial2Mo: string
  MonthlyTrial3Mo: string
  MonthlyTrial6Mo: string
  MonthlyTrial1Year: string
  Promotional1Mo: string
  Promotional2Mo: string
  Promotional3Mo: string
  Promotional6Mo: string
  Promotional1Year: string
}

interface ExpectedProductOffer {
  productId: string
  promotionalOfferId: string
}

@injectable()
export class SubscriptionAppleService {
  constructor(
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(SubscriptionRepo) private subscriptionRepo: SubscriptionRepo,
    @inject(SlaxAlertBotClient) private alertBot: SlaxAlertBotClient,
    @inject(GA4AnalyticsClient) private ga4Client: GA4AnalyticsClient,
    @inject(LogsService) private logsService: LogsService
  ) {}

  private toDateOnly(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  private getProductInfo(isProd: boolean): AppleProductInfo {
    return {
      Monthly: isProd ? 'slax.reader.monthly' : 'app.slax.reader.monthly',
      MonthlyTrial1Mo: isProd ? 'slax.reader.monthly.trial_1mo' : 'app.slax.reader.monthly.trail.1mo',
      MonthlyTrial2Mo: isProd ? 'slax.reader.monthly.trial_2mo' : 'app.slax.reader.monthly.trail.2mo',
      MonthlyTrial3Mo: isProd ? 'slax.reader.monthly.trial_3mo' : 'app.slax.reader.monthly.trail.3mo',
      MonthlyTrial6Mo: isProd ? 'slax.reader.monthly.trial_3mo' : 'app.slax.reader.monthly.trail.6mo',
      MonthlyTrial1Year: isProd ? 'slax.reader.monthly.trial_3mo' : 'app.slax.reader.monthly.trail.1year',
      Promotional1Mo: isProd ? 'promotional_offer_1m' : 'experience_1mo',
      Promotional2Mo: isProd ? 'promotional_offer_2m' : 'experience_2mo',
      Promotional3Mo: isProd ? 'promotional_offer_3m' : 'experience_3mo',
      Promotional6Mo: isProd ? 'promotional_offer_6m' : 'experience_6mo',
      Promotional1Year: isProd ? 'promotional_offer_1y' : 'experience_1year'
    }
  }

  // 根据用户订阅状态计算期望的 productId 和 promotionalOfferId
  private calculateExpectedProductOffer(
    productInfo: AppleProductInfo,
    hasSubscribed: boolean,
    isFreeSubscription: boolean,
    hasTrialRecord: boolean,
    subscriptionEndTime?: Date
  ): ExpectedProductOffer {
    // 情况1: 新用户，未领取过 -> 1个月免费试用
    if (!hasSubscribed && !hasTrialRecord) {
      return {
        productId: productInfo.MonthlyTrial1Mo,
        promotionalOfferId: ''
      }
    }

    // 情况2: 有免费订阅且未过期 -> 根据剩余时间计算 promotional offer
    if (isFreeSubscription && subscriptionEndTime) {
      // 只取日期部分用于月份计算，避免时间差异影响
      const now = this.toDateOnly(new Date())
      const endDate = this.toDateOnly(subscriptionEndTime)

      const fullMonths = differenceInMonths(endDate, now)
      const afterFullMonths = addMonths(now, fullMonths)
      const remainingDays = differenceInDays(endDate, afterFullMonths)
      const remainingMonths = remainingDays > 0 ? fullMonths + 1 : fullMonths
      const cappedRemainingMonths = Math.min(remainingMonths, 3)

      let productId: string
      if (cappedRemainingMonths <= 1) {
        productId = productInfo.MonthlyTrial1Mo
      } else if (cappedRemainingMonths <= 2) {
        productId = productInfo.MonthlyTrial2Mo
      } else {
        productId = productInfo.MonthlyTrial3Mo
      }

      return {
        productId,
        promotionalOfferId: ''
      }
    }

    // 情况3: 其他情况 -> 正常订阅，无优惠
    return {
      productId: productInfo.Monthly,
      promotionalOfferId: ''
    }
  }

  async getAppleIAPProductList(ctx: ContextManager) {
    const infos = this.getProductInfo(ctx.env.RUN_TYPE === 'prod')
    return [infos.Monthly, infos.MonthlyTrial1Mo, infos.MonthlyTrial2Mo, infos.MonthlyTrial3Mo, infos.MonthlyTrial6Mo]
  }

  async createAppleIAPSubscription(
    ctx: ContextManager,
    productId: string,
    offerId?: string
  ): Promise<{
    uuid: string
    promotional_signature?: {
      signature: string
      nonce: string
      timestamp: number
      key_identifier: string
    }
  }> {
    const isProd = ctx.env.RUN_TYPE === 'prod'
    const productInfo = this.getProductInfo(isProd)

    // 检查用户
    const userInfo = await this.userRepo.getUserInfo(ctx.getUserId())
    if (!userInfo || userInfo.deleted_at) throw UserNotFoundError()

    const trialRecord = await this.subscriptionRepo.findReceiveActivityRecord(ctx.getUserId(), receiveActivityType.PLATFORM_0527)

    // 检查是否存在付费订阅（stripe/apple）
    const subscriptionInfo = await this.subscriptionRepo.getUserSubscriptionInfo(ctx.getUserId())
    if (subscriptionInfo && subscriptionInfo.subscription_end_time.getTime() > Date.now()) {
      const sourceType = subscriptionInfo.source_type || ''
      // 如果是付费订阅（stripe/apple），不允许重复订阅
      if (sourceType === 'stripe' || sourceType === 'apple') {
        throw SubscriptionNotExpired()
      }
    }

    // 计算用户订阅状态
    const hasSubscribed = !!subscriptionInfo && subscriptionInfo.subscription_end_time.getTime() > Date.now()
    const sourceType = (hasSubscribed && subscriptionInfo.source_type) || 'none'
    const isFreeSubscription = hasSubscribed && (sourceType === 'system' || sourceType === '')

    // 计算期望的 productId 和 offerId
    const expected = this.calculateExpectedProductOffer(productInfo, hasSubscribed, isFreeSubscription, !!trialRecord, subscriptionInfo?.subscription_end_time)

    // 校验客户端传入的参数是否与服务端计算的一致
    const clientOfferId = offerId || ''
    if (productId !== expected.productId || clientOfferId !== expected.promotionalOfferId) {
      throw AppleIAPProductMismatchError()
    }

    // 如果是 promotional offer，生成签名
    if (offerId) {
      const signatureData = await this.generatePromotionalOfferSignature(ctx, userInfo, productId, offerId)
      return {
        uuid: userInfo.uuid,
        promotional_signature: {
          signature: signatureData.signature,
          nonce: signatureData.nonce,
          timestamp: signatureData.timestamp,
          key_identifier: signatureData.keyIdentifier
        }
      }
    }

    // 普通订阅或试用订阅
    return {
      uuid: userInfo.uuid
    }
  }

  private timeFormat(date: Date) {
    return date.getFullYear() + '-' + (date.getMonth() + 1).toString().padStart(2, '0') + '-' + date.getDate().toString().padStart(2, '0')
  }

  // 订阅页面信息获取
  async getAppleIAPSubscriptionInfo(ctx: ContextManager) {
    // 查询是否领取过免费的
    const trialRecord = await this.subscriptionRepo.hasReceivedAcitivityRecord(ctx.getUserId())
    const subscriptionInfo = await this.subscriptionRepo.getUserSubscriptionInfo(ctx.getUserId())

    const isProd = ctx.env.RUN_TYPE === 'prod'
    const productInfo = this.getProductInfo(isProd)

    const hasSubscribed = !!subscriptionInfo && subscriptionInfo.subscription_end_time.getTime() > Date.now()
    const sourceType = (hasSubscribed && subscriptionInfo.source_type) || 'none'
    const isFreeSubscription = hasSubscribed && (sourceType === 'system' || sourceType === '')

    const expected = this.calculateExpectedProductOffer(productInfo, hasSubscribed, isFreeSubscription, !!trialRecord, subscriptionInfo?.subscription_end_time)

    // 计算 UI 展示信息
    let buttonText = 'Subscribe Now'
    let buttonTipText = '$5.99/mo, cancel anytime'
    let trialMonths = 0
    let earlyRenewalTitle = ''
    let earlyRenewalTip = ''

    if (!hasSubscribed && !trialRecord) {
      // 情况1: 新用户，未领取过 -> 1个月免费试用
      buttonText = 'Start Free Trial'
      buttonTipText = 'Enjoy 1 month free, then $5.99/mo. Cancel anytime.'
      trialMonths = 1
    } else if (isFreeSubscription) {
      // 情况2: 有免费订阅且未过期 -> 根据剩余时间计算 promotional offer（向上取整）
      // 只取日期部分用于月份计算，避免时间差异影响
      const now = this.toDateOnly(new Date())
      const endDate = this.toDateOnly(subscriptionInfo.subscription_end_time)

      const fullMonths = differenceInMonths(endDate, now)
      const afterFullMonths = addMonths(now, fullMonths)
      const remainingDays = differenceInDays(endDate, afterFullMonths)
      // 向上取整：如果有剩余天数，月份数+1
      const remainingMonths = remainingDays > 0 ? fullMonths + 1 : fullMonths

      // 限制最高3个月
      const cappedRemainingMonths = Math.min(remainingMonths, 3)
      const cappedFullMonths = Math.min(fullMonths, 3)

      buttonTipText = '(Auto-renews, cancel anytime)'
      buttonText = 'Subscribe $5.99/Month'
      earlyRenewalTitle = `Your free trial ends on [${this.timeFormat(subscriptionInfo.subscription_end_time)}].`

      if (cappedRemainingMonths <= 1) {
        trialMonths = 1
      } else if (cappedRemainingMonths <= 2) {
        trialMonths = 2
      } else {
        trialMonths = 3
      }
      // 从原有结束日期 + (promotional时长 - 实际完整月数) = extra日期
      // 例如：剩余2个月零2天，promotional 3个月，extra = 结束日期 + 1个月
      const futureDate = addMonths(subscriptionInfo.subscription_end_time, trialMonths - cappedFullMonths)
      earlyRenewalTip = `🎁 Bonus: Subscribe now and enjoy extra Pro access until [${this.timeFormat(futureDate)}].`
    }

    return {
      product: {
        apple_product_id: expected.productId,
        apple_promotional_offer_id: expected.promotionalOfferId,
        early_renewal_title: earlyRenewalTitle,
        early_renewal_tip: earlyRenewalTip,
        trial_months: trialMonths,
        button_text: buttonText,
        button_tip_text: buttonTipText,
        pay_price: 'US$5.99',
        pay_interval: 'Month',
        origin_price: 'US$9.99',
        feature_supplement: '💡 All these Pro features are now available on the web app — and we’re bringing them to mobile soon!',
        feature: ['Everything in Free, plus:', 'Interactive AI chat', 'Auto-tagging', 'Advanced semantic search', 'Priority support', 'Instant AI outline'],
        highlight: [0]
      },
      subscription: {
        type: sourceType,
        end_time: subscriptionInfo ? subscriptionInfo.subscription_end_time : null,
        auto_renew: subscriptionInfo ? subscriptionInfo.auto_renew : false,
        stripe_home: subscriptionInfo && subscriptionInfo.source_type == 'stripe' ? ctx.env.STRIPE_SUBSCRIPTION_HOME : ''
      }
    }
  }

  // 生成 Apple IAP 促销优惠签名
  async generatePromotionalOfferSignature(
    ctx: ContextManager,
    userInfo: userInfoPO,
    productId: string,
    offerId: string
  ): Promise<{
    signature: string
    nonce: string
    timestamp: number
    keyIdentifier: string
  }> {
    const env = ctx.env
    const keyId = env.APP_STORE_API_KEY_ID
    const bundleId = env.APP_STORE_BUNDLE_ID
    const privateKeyRaw = env.APP_STORE_API_PRIVATE_KEY

    if (!keyId || !bundleId || !privateKeyRaw) {
      throw ErrorParam()
    }

    const applicationUsername = userInfo.uuid
    const nonce = crypto.randomUUID().toLowerCase()
    const timestamp = Date.now()

    const signature = await this.signPromotionalOffer({
      bundleId,
      keyId,
      productId,
      offerId,
      applicationUsername,
      nonce,
      timestamp,
      privateKey: privateKeyRaw
    })

    return {
      signature,
      nonce,
      timestamp,
      keyIdentifier: keyId
    }
  }

  // 签名促销优惠参数
  private async signPromotionalOffer(params: {
    bundleId: string
    keyId: string
    productId: string
    offerId: string
    applicationUsername: string
    nonce: string
    timestamp: number
    privateKey: string
  }): Promise<string> {
    const { bundleId, keyId, productId, offerId, applicationUsername, nonce, timestamp, privateKey } = params

    const separator = '\u2063'
    const payload = [bundleId, keyId, productId, offerId, applicationUsername, nonce, timestamp.toString()].join(separator)

    // 处理私钥格式
    const formattedKey = privateKey
      .replace(/\\n/g, '\n')
      .replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n')
      .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----')

    const ecPrivateKey = await jose.importPKCS8(formattedKey, 'ES256')

    // 使用 ECDSA P-256 + SHA-256 签名
    const encoder = new TextEncoder()
    const data = encoder.encode(payload)

    const cryptoKey = ecPrivateKey as CryptoKey
    const signatureBuffer = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, data)

    // 返回 Base64 编码的签名
    const signatureArray = new Uint8Array(signatureBuffer)
    return btoa(String.fromCharCode(...signatureArray))
  }

  private validateAppleApplication(env: Env, bundleId: string, environment: Environment) {
    const expectedEnvironment = env.RUN_TYPE === 'prod' ? Environment.PRODUCTION : Environment.SANDBOX
    if (!env.APP_STORE_BUNDLE_ID || bundleId !== env.APP_STORE_BUNDLE_ID || environment !== expectedEnvironment) {
      throw ErrorParam()
    }
  }

  private validateAppleProduct(env: Env, productId: string) {
    const products = this.getProductInfo(env.RUN_TYPE === 'prod')
    if (
      ![products.Monthly, products.MonthlyTrial1Mo, products.MonthlyTrial2Mo, products.MonthlyTrial3Mo, products.MonthlyTrial6Mo, products.MonthlyTrial1Year].includes(productId)
    ) {
      throw AppleIAPProductMismatchError()
    }
  }

  private validateAppleTransaction(env: Env, transaction: JWSTransactionDecodedPayload) {
    this.validateAppleApplication(env, transaction.bundleId, transaction.environment)
    this.validateAppleProduct(env, transaction.productId)
    if (!transaction.transactionId || !transaction.originalTransactionId || !transaction.appAccountToken || transaction.type !== TransactionType.AUTO_RENEWABLE_SUBSCRIPTION) {
      throw ErrorParam()
    }
  }

  private isActiveAppleTransaction(transaction: JWSTransactionDecodedPayload): boolean {
    const now = Date.now()
    return (
      transaction.revocationDate === undefined &&
      transaction.revocationReason === undefined &&
      !transaction.isUpgraded &&
      Number.isFinite(transaction.purchaseDate) &&
      transaction.purchaseDate > 0 &&
      transaction.purchaseDate <= now &&
      typeof transaction.expiresDate === 'number' &&
      Number.isFinite(transaction.expiresDate) &&
      transaction.expiresDate > now &&
      transaction.expiresDate > transaction.purchaseDate &&
      !Number.isNaN(new Date(transaction.expiresDate).getTime())
    )
  }

  async checkAppleIAPSubscription(ctx: ContextManager, productId: string, orderId: string, jwsRepresentation: string): Promise<boolean> {
    const verifier = new AppleJWSVerifier()
    const transaction = await verifier.verifyAndDecode<JWSTransactionDecodedPayload>(jwsRepresentation)
    this.validateAppleTransaction(ctx.env, transaction)

    const user = await this.userRepo.getUserInfo(ctx.getUserId())
    if (!user || !user.id || user.deleted_at) throw UserNotFoundError()
    if (user.id !== ctx.getUserId() || !user.uuid || transaction.appAccountToken !== user.uuid || orderId !== user.uuid) {
      throw ErrorParam()
    }
    if (transaction.productId !== productId) throw AppleIAPProductMismatchError()
    if (!this.isActiveAppleTransaction(transaction)) return false

    await this.handleSubscriptionActive(user.id, NotificationType.SUBSCRIBED, transaction.originalTransactionId, transaction, null)
    return this.subscriptionRepo.hasActivePaymentGrant(`apple:${transaction.bundleId}:${transaction.environment}:${transaction.transactionId}`, user.id)
  }

  async handleAppleIAPNotificationEvent(ctx: ContextManager, data: string) {
    const verifier = new AppleJWSVerifier()
    try {
      const verifiedData = await verifier.verifyAndDecode<ResponseBodyV2DecodedPayload>(data)
      const transactionInfo = verifiedData.data?.signedTransactionInfo
        ? await verifier.verifyAndDecode<JWSTransactionDecodedPayload>(verifiedData.data.signedTransactionInfo)
        : null
      const renewalInfo = verifiedData.data?.signedRenewalInfo ? await verifier.verifyAndDecode<JWSRenewalInfoDecodedPayload>(verifiedData.data.signedRenewalInfo) : null

      if (!verifiedData || !verifiedData.data || !transactionInfo) {
        console.error(`Apple IAP notification: missing transaction info, raw data: ${verifiedData}`)
        return
      }

      this.validateAppleApplication(ctx.env, verifiedData.data.bundleId, verifiedData.data.environment)
      this.validateAppleTransaction(ctx.env, transactionInfo)
      if (renewalInfo) {
        if (renewalInfo.environment !== transactionInfo.environment || renewalInfo.originalTransactionId !== transactionInfo.originalTransactionId) {
          throw ErrorParam()
        }
        this.validateAppleProduct(ctx.env, renewalInfo.productId)
        this.validateAppleProduct(ctx.env, renewalInfo.autoRenewProductId)
      }
      if (
        [NotificationType.SUBSCRIBED, NotificationType.DID_RENEW, NotificationType.DID_CHANGE_RENEWAL_PREF].includes(verifiedData.notificationType) &&
        !this.isActiveAppleTransaction(transactionInfo)
      ) {
        return
      }

      const appAccountToken = transactionInfo.appAccountToken!
      const user = await this.userRepo.getUserByUuid(appAccountToken)
      if (!user || !user.id || user.deleted_at || user.uuid !== appAccountToken) {
        throw UserNotFoundError()
      }

      const userId = user.id
      const originalTransactionId = transactionInfo.originalTransactionId
      const productId = transactionInfo.productId
      const notificationType = verifiedData.notificationType
      const subType = `${verifiedData.notificationType} - ${verifiedData.subtype || ''}`
      const environment = verifiedData.data?.environment

      const key = `apple:${transactionInfo.bundleId}:${environment}:notification:${verifiedData.notificationUUID}`
      await this.subscriptionRepo.enqueuePaymentJob(
        key,
        'apple_event',
        JSON.parse(JSON.stringify({ userId, originalTransactionId, productId, notificationType, transactionInfo, renewalInfo, environment }))
      )
      await this.recoverAppleEvent(ctx.env, key)

      console.log(`Apple IAP notification processed: ${notificationType} for user ${userId}`)
    } catch (e: any) {
      console.error(`Apple IAP notification error: ${e.message}`, e)
      throw e
    }
  }

  public async recoverAppleEvent(env: Env, key: string) {
    const job = await this.subscriptionRepo.getPaymentJob(key)
    if (!job || job.status === 'done' || job.status === 'reconciliation') return
    const token = await this.subscriptionRepo.claimPaymentJob(key)
    if (!token) throw new Error('Apple event is leased')
    try {
      const data = job.payload as any
      this.validateAppleApplication(env, data.transactionInfo.bundleId, data.transactionInfo.environment)
      await this.processSubscriptionEvent(
        env,
        data.userId,
        data.originalTransactionId,
        data.productId,
        data.notificationType,
        data.transactionInfo,
        data.renewalInfo,
        data.environment
      )
      await this.subscriptionRepo.finishPaymentJob(key, token)
    } catch (error) {
      await this.subscriptionRepo.finishPaymentJob(key, token, String(error))
      throw error
    }
  }

  private async processSubscriptionEvent(
    env: Env,
    userId: number,
    originalTransactionId: string,
    productId: string,
    notificationType: NotificationType,
    transactionInfo: JWSTransactionDecodedPayload,
    renewalInfo: JWSRenewalInfoDecodedPayload | null,
    environment?: Environment
  ) {
    // 根据通知类型处理订阅
    switch (notificationType) {
      case NotificationType.SUBSCRIBED:
      case NotificationType.DID_RENEW:
      case NotificationType.DID_CHANGE_RENEWAL_PREF:
        await this.handleSubscriptionActive(userId, notificationType, originalTransactionId, transactionInfo, renewalInfo)
        break

      case NotificationType.EXPIRED:
      case NotificationType.GRACE_PERIOD_EXPIRED:
        await this.handleSubscriptionExpired(userId, originalTransactionId, transactionInfo)
        break

      case NotificationType.REFUND:
        await this.handleSubscriptionRefund(userId, originalTransactionId, transactionInfo)
        break

      case NotificationType.DID_FAIL_TO_RENEW:
        // 续订失败，暂不处理，等待用户重新支付或过期
        console.log(`Subscription renewal failed for user ${userId}`)
        break

      case NotificationType.DID_CHANGE_RENEWAL_STATUS:
        // 自动续订状态变更
        if (renewalInfo) {
          await this.handleRenewalStatusChange(userId, originalTransactionId, renewalInfo, transactionInfo.bundleId)
        }
        break
      case NotificationType.CONSUMPTION_REQUEST:
        await this.handleConsumptionRequest(env, userId, originalTransactionId, productId, transactionInfo, environment)
        break

      default:
        console.log(`Unhandled Apple IAP notification type: ${notificationType}`)
    }
  }

  // 处理订阅激活或续订
  private async handleSubscriptionActive(
    userId: number,
    notificationType: NotificationType,
    originalTransactionId: string,
    transactionInfo: JWSTransactionDecodedPayload,
    renewalInfo: JWSRenewalInfoDecodedPayload | null
  ) {
    if (!this.isActiveAppleTransaction(transactionInfo) || !transactionInfo.expiresDate) return
    if (renewalInfo) await this.handleRenewalStatusChange(userId, originalTransactionId, renewalInfo, transactionInfo.bundleId)

    await this.subscriptionRepo.applyPaymentGrant({
      key: `apple:${transactionInfo.bundleId}:${transactionInfo.environment}:${transactionInfo.transactionId}`,
      scope: `apple:${transactionInfo.bundleId}:${transactionInfo.environment}`,
      userId,
      provider: 'apple',
      source: originalTransactionId,
      amount: 0,
      interval: subscriptionInterval.MINUTE,
      count: Math.ceil((transactionInfo.expiresDate - transactionInfo.purchaseDate) / 60000),
      at: new Date(transactionInfo.purchaseDate),
      nextInvoiceAt: new Date(transactionInfo.expiresDate),
      autoRenew: renewalInfo ? renewalInfo.autoRenewStatus === AutoRenewStatus.ON : true,
      appleTransactionId: transactionInfo.transactionId,
      consumeBonus: transactionInfo.offerType === OfferType.INTRODUCTORY || transactionInfo.offerType === OfferType.PROMOTIONAL,
      notificationType,
      telemetryType: notificationType === NotificationType.SUBSCRIBED ? 'initial_subscription' : 'auto_renewal'
    })
  }

  // 处理订阅过期
  private async handleSubscriptionExpired(userId: number, originalTransactionId: string, transaction: JWSTransactionDecodedPayload) {
    if (!transaction.expiresDate) return
    await this.subscriptionRepo.paymentTransaction(userId, async (repo, tx) => {
      await tx.sr_user_subscription.updateMany({
        where: { user_id: userId, source_type: 'apple', apple_original_transaction_id: originalTransactionId, next_invoice_time: { lte: new Date(transaction.expiresDate!) } },
        data: { auto_renew: false, subscribed: false }
      })
    })
  }

  private async handleSubscriptionRefund(userId: number, originalTransactionId: string, transaction: JWSTransactionDecodedPayload) {
    await this.subscriptionRepo.applyPaymentRefund({
      key: `apple:${transaction.bundleId}:${transaction.environment}:${transaction.transactionId}`,
      scope: `apple:${transaction.bundleId}:${transaction.environment}`,
      userId,
      provider: 'apple',
      source: originalTransactionId,
      total: 0,
      cumulative: 0,
      refundIds: [{ id: transaction.transactionId, amount: 0 }],
      revoked: true
    })
  }

  // 处理自动续订状态变更
  private async handleRenewalStatusChange(userId: number, originalTransactionId: string, renewalInfo: JWSRenewalInfoDecodedPayload, bundleId: string) {
    await this.subscriptionRepo.writePaymentState({
      key: `apple:${bundleId}:${renewalInfo.environment}:state:${originalTransactionId}`,
      provider: 'apple',
      userId,
      source: originalTransactionId,
      autoRenew: renewalInfo.autoRenewStatus === AutoRenewStatus.ON,
      version: renewalInfo.signedDate,
      eventId: `${renewalInfo.signedDate}:${renewalInfo.autoRenewStatus}`
    })
  }

  private async handleConsumptionRequest(
    env: Env,
    userId: number,
    originalTransactionId: string,
    productId: string,
    transactionInfo: JWSTransactionDecodedPayload,
    environment?: Environment
  ) {
    await this.sendConsumptionInformation(env, transactionInfo.transactionId, transactionInfo.appAccountToken, environment)
    await this.subscriptionRepo.enqueuePaymentJob(`apple:${transactionInfo.bundleId}:${environment}:consumption_notice:${transactionInfo.transactionId}`, 'payment_notice', {
      channel: 'stripe',
      content: `Apple consumption response submitted for user ${userId}, transaction ${transactionInfo.transactionId}`
    })
  }

  private async sendConsumptionInformation(env: Env, originalTransactionId: string, appAccountToken?: string, environment?: Environment) {
    const keyId = env.APP_STORE_API_KEY_ID
    const issuerId = env.APP_STORE_ISSUER_ID
    const bundleId = env.APP_STORE_BUNDLE_ID
    const privateKeyRaw = env.APP_STORE_API_PRIVATE_KEY
    if (!keyId || !issuerId || !bundleId || !privateKeyRaw) {
      throw new Error('Missing App Store Server API config')
    }

    const privateKey = privateKeyRaw
      .replace(/\\n/g, '\n')
      .replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n')
      .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----')

    const now = Math.floor(Date.now() / 1000)
    const signer = new jose.SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 1800)
      .setAudience('appstoreconnect-v1')
      .setIssuer(issuerId)
      .setSubject(bundleId)

    const importKey = await jose.importPKCS8(privateKey, 'ES256')
    const token = await signer.sign(importKey)

    const host = environment === Environment.SANDBOX ? 'https://api.storekit-sandbox.itunes.apple.com' : 'https://api.storekit.itunes.apple.com'
    const url = `${host}/inApps/v1/transactions/consumption/${originalTransactionId}`

    const body = {
      consumptionStatus: 3,
      refundPreference: 2,
      customerConsented: true,
      ...(appAccountToken ? { appAccountToken } : {})
    }

    try {
      const resp = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!resp.ok) {
        throw new Error(`sendConsumptionInformation failed: ${resp.status} ${await resp.text()}`)
      }
    } catch (err) {
      throw err
    }
  }
}
