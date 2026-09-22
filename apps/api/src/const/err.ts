import { MultiLangError, Language } from '@/utils/multiLangError'

import { ErrorName } from '@slax-reader/contracts'
export { ErrorName } from '@slax-reader/contracts'

const translations: { [key in Language]: Partial<Record<ErrorName, string>> } = {
  zh: {
    [ErrorName.NOT_FOUND]: '资源未找到',
    [ErrorName.UNAUTHORIZED]: '未授权访问',
    [ErrorName.SERVER_ERROR]: '服务器内部错误',
    [ErrorName.GOOGLE_SSO_ERROR]: 'Google SSO错误',
    [ErrorName.GOOGLE_SSO_RESP_ERROR]: 'Google SSO响应错误',
    [ErrorName.GOOGLE_SSO_AUD_ERROR]: '无效的Google SSO受众',
    [ErrorName.REGISTER_USER_ERROR]: '注册用户失败',
    [ErrorName.ERROR_PARAM]: '无效参数',
    [ErrorName.USER_NOT_FOUND]: '用户未找到',
    [ErrorName.DELETE_BOOKMARK_FAIL]: '删除书签失败',
    [ErrorName.TRASH_BOOKMARK_FAIL]: '移入垃圾篓失败',
    [ErrorName.TRASH_REVERT_BOOKMARK_FAIL]: '移出垃圾篓失败',
    [ErrorName.BOOKMARK_NOT_FOUND]: '书签未找到',
    [ErrorName.BLOCK_TARGET_URL]: '目标网址被阻止',
    [ErrorName.CREATE_BOOKMARK_FAIL]: '创建书签失败',
    [ErrorName.USER_ID_WRONG]: '用户id错误',
    [ErrorName.DECODE_ID_ERROR]: '解码id错误',
    [ErrorName.FAIL_TO_SUMMARY]: '生成摘要失败',
    [ErrorName.EXISTS_USER_NAME_ERROR]: '用户名已存在',
    [ErrorName.REUQEST_APPLE_AUTH_FAIL]: 'Apple 登录失败，请重试',
    [ErrorName.SUMMARY_UPDATE_REACH_LIMITED]: '总结刷新次数达到限制',
    [ErrorName.VECTORIZE_FAILED]: '转换向量失败',
    [ErrorName.EMAIL_DAILY_LIMIT]: '今日发送邮件次数达到限制, 请明天再试吧',
    [ErrorName.EMAIL_VERIFY_CODE_EXISTS]: '重复发送验证码, 请30秒后重试',
    [ErrorName.EMAIL_VERIFY_CODE_ERROR]: '验证码错误',
    [ErrorName.EMAIL_VERIFY_CODE_RATE_LIMIT]: '验证码错误次数过多, 请稍后再试',
    [ErrorName.TOO_MANY_REQUESTS]: '请求过于频繁, 请稍后再试',
    [ErrorName.QUOTA_EXCEEDED]: '配额已满',
    [ErrorName.SHARE_COLLECTION_NOT_FOUND]: '分享的collection未找到',
    [ErrorName.ERROR_CONNECTION_PARAM]: '错误的连接参数',
    [ErrorName.NOT_ALLOWED_EMAIL]: '非白名单邮箱，请检查',
    [ErrorName.SHARE_COLLECTION_ALREADY_SUBSCRIBED]: '已订阅',
    [ErrorName.SHARE_COLLECTION_NOT_SUBSCRIBED]: '未订阅',
    [ErrorName.SHARE_COLLECTION_EXPIRED]: '订阅的Collection已过期，请检查',
    [ErrorName.SHARE_COLLECTION_UPDATE_PRICE_FAIL]: '更新分享的collection价格失败',
    [ErrorName.SHARE_COLLECTION_NOT_ALLOWED]: '分享的collection不允许评论',
    [ErrorName.SHARE_COLLECTION_CLOSED]: '专栏已关闭',
    [ErrorName.STRIPE_CANCEL_SUBSCRIPTION_ERROR]: '取消订阅失败',
    [ErrorName.RECOVER_SUBSCRIBE_ERROR]: '重新订阅功能正在开发中，敬请期待',
    [ErrorName.SHARE_COLLECTION_CANT_UPDATE_FREE]: '分享的collection不能免费转付费',
    [ErrorName.NOT_HAVE_STRIPE_ACCOUNT_ERROR]: '没有stripe账户',
    [ErrorName.REDEEM_CODE_NOT_FOUND_OR_USED]: '兑换码不存在或已使用',
    [ErrorName.BOOKMARK_CHANGES_SYNC_TOO_OLD]: '书签更改同步过旧',
    [ErrorName.RECEIVE_ACTIVITY_TYPE_NOT_FOUND]: '活动类型不存在',
    [ErrorName.RECEIVE_ACTIVITY_ALREADY_RECEIVED]: '该活动已领取过',
    [ErrorName.HAS_UNFINISHED_IMPORT_TASK]: '存在未完成的导入任务，请先等待完成',
    [ErrorName.TOO_MANY_IMPORT_TASKS]: '同时最多 5 个导入任务，请等其中一个完成后再试',
    [ErrorName.READABILITY_PARSE_NO_PARSER]: '解析失败，请稍后再试',
    [ErrorName.READABILITY_PARSE_WEIXIN_CALLBACK_FAIL]: '微信回调失败，请稍后再试',
    [ErrorName.PUPPETEER_TIMEOUT]: 'Puppeteer抓取超时',
    [ErrorName.ZYTE_TIMEOUT]: 'Zyte抓取超时',
    [ErrorName.WEIXIN_ENV_ABNORMAL]: '微信环境异常，抓取失败',
    [ErrorName.DAJIALA_ARTICLE_UNAVAILABLE]: '微信文章无法访问（账号已被屏蔽 / 文章已删除 / 内容为空）',
    [ErrorName.DELETE_IMPORT_FAILED_BOOKMARK_FAIL]: '删除导入失败的书签失败',
    [ErrorName.BOOKMARK_CONTENT_NOT_FOUND]: '书签内容未找到',
    [ErrorName.BOOKMARK_OVERVIEW_CONTENT_ERROR]: '书签概览内容错误',
    [ErrorName.ACCOUNT_DELETION_NOT_ALLOWED]: '账户无法注销',
    [ErrorName.USER_ACCOUNT_DELETED]: '该账户已被删除',
    [ErrorName.APPLE_IAP_PRODUCT_MISMATCH]: '订阅产品信息不匹配，请刷新后重试',
    [ErrorName.PLATFORM_ALREADY_BOUND]: '该平台账号已绑定',
    [ErrorName.OAUTH2_STATE_EXPIRED]: 'OAuth授权已过期，请重新发起绑定',
    [ErrorName.OAUTH2_STATE_INVALID]: 'OAuth授权状态无效',
    [ErrorName.OAUTH2_TOKEN_EXCHANGE_ERROR]: 'Twitter授权失败，请重试',
    [ErrorName.OAUTH2_USER_INFO_ERROR]: '获取Twitter用户信息失败',
    [ErrorName.PLATFORM_ACCOUNT_BOUND_TO_OTHER_USER]: '该Twitter账号已被其他用户绑定',
    [ErrorName.INVALID_API_KEY]: '无效的API Key',
    [ErrorName.API_KEY_NOT_FOUND]: 'API Key未找到',
    [ErrorName.API_KEY_REVOKED]: 'API Key已被吊销',
    [ErrorName.API_KEY_LIMIT_EXCEEDED]: 'API Key数量达到上限',
    [ErrorName.API_KEY_ROUTE_NOT_ALLOWED]: '该API Key不允许访问此接口',
    [ErrorName.LAB_FEATURE_DISABLED]: '{feature}还在实验室里，请到设置页打开后再保存',
    [ErrorName.PROHIBITED_CONTENT]: '处理失败：内容被禁止',
    [ErrorName.SHARE_CONTENT_NOT_SUPPORTED]: '该内容类型不支持分享',
    [ErrorName.SYNC_TABLE_RULE_ERROR]: '同步表规则错误',
    [ErrorName.SYNC_TABLE_TAG_NAME_ERROR]: '同步表标签名称错误'
  },
  en: {
    [ErrorName.NOT_FOUND]: 'Resource not found',
    [ErrorName.UNAUTHORIZED]: 'Unauthorized access',
    [ErrorName.SERVER_ERROR]: 'Internal server error',
    [ErrorName.GOOGLE_SSO_ERROR]: 'Google SSO error',
    [ErrorName.GOOGLE_SSO_RESP_ERROR]: 'Google SSO response error',
    [ErrorName.GOOGLE_SSO_AUD_ERROR]: 'Invalid Google SSO audience',
    [ErrorName.REGISTER_USER_ERROR]: 'Register user failed',
    [ErrorName.ERROR_PARAM]: 'Invalid parameter',
    [ErrorName.USER_NOT_FOUND]: 'User not found',
    [ErrorName.DELETE_BOOKMARK_FAIL]: 'Delete bookmark failed',
    [ErrorName.TRASH_BOOKMARK_FAIL]: 'Trash bookmark failed',
    [ErrorName.TRASH_REVERT_BOOKMARK_FAIL]: 'Revert bookmark failed',
    [ErrorName.BOOKMARK_NOT_FOUND]: 'Bookmark not found',
    [ErrorName.BLOCK_TARGET_URL]: 'Blocked target url',
    [ErrorName.CREATE_BOOKMARK_FAIL]: 'Create bookmark failed',
    [ErrorName.USER_ID_WRONG]: 'User id wrong',
    [ErrorName.DECODE_ID_ERROR]: 'Decode id error',
    [ErrorName.FAIL_TO_SUMMARY]: 'Failed to summary',
    [ErrorName.SAVE_REPORT_ERROR]: 'Save report error',
    [ErrorName.UNKNOWN_BIND_USER_ERROR]: 'Unknown bind user error',
    [ErrorName.EXISTS_USER_NAME_ERROR]: 'User name exists',
    [ErrorName.NEED_CREATE_ACCOUNT_NAME]: 'Need create account username',
    [ErrorName.REUQEST_APPLE_AUTH_FAIL]: 'Apple login failed, please try again',
    [ErrorName.SUBSCRIPTION_NOT_EXPIRED]: 'You have a subscription not expired',
    [ErrorName.INTERNET_SEARCH_FAIL]: 'Internet search fail',
    [ErrorName.AI_RATE_LIMIT]: 'AI rate limit',
    [ErrorName.AI_ERROR]: `The AI provider has made a mistake. Don't worry, it's switching to the backup provider. \n`,
    [ErrorName.NOT_SUBSCRIPTION]: 'Not subscription',
    [ErrorName.AI_CONTENT_HARMFUL]: `Apologies, your message can't be processed due to potentially harmful content in the chat history or article. `,
    [ErrorName.CREATE_BOOKMARK_SHARE_UNIQUE_FAIL]: 'Create bookmark share unique fail',
    [ErrorName.SHARE_DISABLED]: 'Share disabled',
    [ErrorName.SHARE_CODE_NOT_FOUND]: 'Share code not found',
    [ErrorName.SHARE_ACTION_NOT_ALLOWED]: 'Share action not allowed',
    [ErrorName.ERROR_MARK_TYPE]: 'Error mark type',
    [ErrorName.MARK_LINE_TOO_LONG]: 'Mark line too long',
    [ErrorName.ERROR_MARK_COMMENT_TYPE]: 'Error mark comment type',
    [ErrorName.READABILITY_PARSE_ERROR]: 'Readability parse error',
    [ErrorName.COMMENT_TOO_LONG]: 'Comment too long',
    [ErrorName.IMPORT_TASK_EXISTS]: 'Import task exists, please wait for the task to complete',
    [ErrorName.SUMMARY_UPDATE_REACH_LIMITED]: 'Summary refresh counts reach limited',
    [ErrorName.VECTORIZE_FAILED]: 'Vectorize failed',
    [ErrorName.EMAIL_DAILY_LIMIT]: 'Today email send counts reach limited, please try again tomorrow',
    [ErrorName.EMAIL_VERIFY_CODE_EXISTS]: 'Repeat send verify code, please try again after 30 seconds',
    [ErrorName.EMAIL_VERIFY_CODE_ERROR]: 'Verify code error',
    [ErrorName.EMAIL_VERIFY_CODE_RATE_LIMIT]: 'Verify code error counts too much, please try again later',
    [ErrorName.TOO_MANY_REQUESTS]: 'Too many requests, please try again later',
    [ErrorName.QUOTA_EXCEEDED]: 'Quota exceeded',
    [ErrorName.ERROR_CONNECTION_PARAM]: 'Error connection param',
    [ErrorName.NOT_ALLOWED_EMAIL]: 'Not allowed email, please check',
    [ErrorName.SHARE_COLLECTION_NOT_FOUND]: 'Share collection not found',
    [ErrorName.SHARE_COLLECTION_NOT_SUPPORT_PRICE_CHANGE]: 'Share collection not support free change to paid or paid change to free',
    [ErrorName.SHARE_COLLECTION_ALREADY_SUBSCRIBED]: 'Already subscribed',
    [ErrorName.SHARE_COLLECTION_NOT_SUBSCRIBED]: 'Not subscribed',
    [ErrorName.SHARE_COLLECTION_EXPIRED]: 'Subscription expired, please check',
    [ErrorName.SHARE_COLLECTION_UPDATE_PRICE_FAIL]: 'Update share collection price failed',
    [ErrorName.SHARE_COLLECTION_NOT_ALLOWED]: 'Share collection not allowed',
    [ErrorName.SHARE_COLLECTION_CLOSED]: 'Collection is closed',
    [ErrorName.STRIPE_CANCEL_SUBSCRIPTION_ERROR]: 'Cancel subscription failed',
    [ErrorName.RECOVER_SUBSCRIBE_ERROR]: "We're working on resubscribe feature.",
    [ErrorName.SHARE_COLLECTION_CANT_UPDATE_FREE]: 'Share collection cant update to free',
    [ErrorName.NOT_HAVE_STRIPE_ACCOUNT_ERROR]: 'No stripe account',
    [ErrorName.REDEEM_CODE_NOT_FOUND_OR_USED]: 'Redeem code not found or used',
    [ErrorName.BOOKMARK_CHANGES_SYNC_TOO_OLD]: 'Bookmark changes sync too old',
    [ErrorName.RECEIVE_ACTIVITY_TYPE_NOT_FOUND]: 'Activity type not found',
    [ErrorName.RECEIVE_ACTIVITY_ALREADY_RECEIVED]: 'Activity already received',
    [ErrorName.HAS_UNFINISHED_IMPORT_TASK]: 'Has unfinished import task, please wait for the task to complete',
    [ErrorName.TOO_MANY_IMPORT_TASKS]: 'You can run up to 5 imports at a time. Wait for one to finish and try again.',
    [ErrorName.READABILITY_PARSE_NO_PARSER]: 'Parse failed, please try again later',
    [ErrorName.READABILITY_PARSE_WEIXIN_CALLBACK_FAIL]: 'Weixin callback failed, please try again later',
    [ErrorName.PUPPETEER_TIMEOUT]: 'Puppeteer fetch timeout',
    [ErrorName.ZYTE_TIMEOUT]: 'Zyte fetch timeout',
    [ErrorName.WEIXIN_ENV_ABNORMAL]: 'Weixin environment abnormal, fetch failed',
    [ErrorName.DAJIALA_ARTICLE_UNAVAILABLE]: 'Weixin article unavailable (account blocked / article deleted / empty content)',
    [ErrorName.DELETE_IMPORT_FAILED_BOOKMARK_FAIL]: 'Delete import failed bookmark failed',
    [ErrorName.BOOKMARK_CONTENT_NOT_FOUND]: 'Bookmark content not found',
    [ErrorName.BOOKMARK_OVERVIEW_CONTENT_ERROR]: 'Bookmark overview content error',
    [ErrorName.ACCOUNT_DELETION_NOT_ALLOWED]: 'Account deletion not allowed',
    [ErrorName.USER_ACCOUNT_DELETED]: 'This account has been deleted',
    [ErrorName.APPLE_IAP_PRODUCT_MISMATCH]: 'Subscription product mismatch, please refresh and try again',
    [ErrorName.PLATFORM_ALREADY_BOUND]: 'Platform account already bound',
    [ErrorName.OAUTH2_STATE_EXPIRED]: 'OAuth authorization expired, please try again',
    [ErrorName.OAUTH2_STATE_INVALID]: 'OAuth state invalid',
    [ErrorName.OAUTH2_TOKEN_EXCHANGE_ERROR]: 'Twitter authorization failed, please retry',
    [ErrorName.OAUTH2_USER_INFO_ERROR]: 'Failed to get Twitter user info',
    [ErrorName.PLATFORM_ACCOUNT_BOUND_TO_OTHER_USER]: 'This Twitter account is already bound to another user',
    [ErrorName.INVALID_API_KEY]: 'Invalid API Key',
    [ErrorName.API_KEY_NOT_FOUND]: 'API Key not found',
    [ErrorName.API_KEY_REVOKED]: 'API Key has been revoked',
    [ErrorName.API_KEY_LIMIT_EXCEEDED]: 'API Key limit exceeded',
    [ErrorName.API_KEY_ROUTE_NOT_ALLOWED]: 'This API Key is not allowed to access this endpoint',
    [ErrorName.LAB_FEATURE_DISABLED]: '{feature} are still in Labs. Turn it on in Settings, then save again',
    [ErrorName.PROHIBITED_CONTENT]: 'Processing failed: prohibited content',
    [ErrorName.SHARE_CONTENT_NOT_SUPPORTED]: 'This type of content cannot be shared',
    [ErrorName.SYNC_TABLE_RULE_ERROR]: 'Sync table rule error',
    [ErrorName.SYNC_TABLE_TAG_NAME_ERROR]: 'Sync table tag name error'
  },
  es: {
    [ErrorName.NOT_FOUND]: 'Recurso no encontrado',
    [ErrorName.UNAUTHORIZED]: 'Acceso no autorizado',
    [ErrorName.SERVER_ERROR]: 'Error interno del servidor',
    [ErrorName.GOOGLE_SSO_ERROR]: 'Error de Google SSO',
    [ErrorName.READABILITY_PARSE_NO_PARSER]: 'Parse failed, please try again later',
    [ErrorName.PROHIBITED_CONTENT]: 'Error de procesamiento: contenido prohibido',
    [ErrorName.LAB_FEATURE_DISABLED]: '{feature} todavía están en el Laboratorio. Actívalo en Ajustes y vuelve a guardar',
    [ErrorName.SHARE_CONTENT_NOT_SUPPORTED]: 'Este tipo de contenido no se puede compartir'
  }
}

const loadErrorMessages = (name: ErrorName): { [lang in Language]?: string } => {
  const messages: { [lang in Language]?: string } = {}
  for (const lang in translations) {
    if (translations.hasOwnProperty(lang)) {
      const translation = translations[lang as Language]
      if (translation && translation[name]) {
        messages[lang as Language] = translation[name]
      }
    }
  }
  return messages
}

export const NewError = (name: ErrorName, code: number): MultiLangError => {
  const messages = loadErrorMessages(name)
  return new MultiLangError(name as any, code, messages)
}

export const NotFoundError = (): MultiLangError => NewError(ErrorName.NOT_FOUND, 404)
export const UnauthorizedError = (): MultiLangError => NewError(ErrorName.UNAUTHORIZED, 401)
export const ServerError = (): MultiLangError => NewError(ErrorName.SERVER_ERROR, 500)
export const GoogleSSOError = (): MultiLangError => NewError(ErrorName.GOOGLE_SSO_ERROR, 500)
export const GoogleSSORespError = (): MultiLangError => NewError(ErrorName.GOOGLE_SSO_RESP_ERROR, 500)
export const GoogleSSOAudError = (): MultiLangError => NewError(ErrorName.GOOGLE_SSO_AUD_ERROR, 500)
export const RegisterUserError = (): MultiLangError => NewError(ErrorName.REGISTER_USER_ERROR, 500)
export const ErrorParam = (): MultiLangError => NewError(ErrorName.ERROR_PARAM, 400)
export const UserNotFoundError = (): MultiLangError => NewError(ErrorName.USER_NOT_FOUND, 404)
export const DeleteBookmarkFailError = (): MultiLangError => NewError(ErrorName.DELETE_BOOKMARK_FAIL, 400)
export const TrashBookmarkFailError = (): MultiLangError => NewError(ErrorName.TRASH_BOOKMARK_FAIL, 400)
export const TrashRevertBookmarkFailError = (): MultiLangError => NewError(ErrorName.TRASH_REVERT_BOOKMARK_FAIL, 400)
export const BookmarkNotFoundError = (): MultiLangError => NewError(ErrorName.BOOKMARK_NOT_FOUND, 404)
export const BlockTargetUrlError = (): MultiLangError => NewError(ErrorName.BLOCK_TARGET_URL, 400)
export const CreateBookmarkFailError = (): MultiLangError => NewError(ErrorName.CREATE_BOOKMARK_FAIL, 500)
export const UserIdWrongError = (): MultiLangError => NewError(ErrorName.USER_ID_WRONG, 500)
export const DecodeIdError = (): MultiLangError => NewError(ErrorName.DECODE_ID_ERROR, 500)
export const FailToSummaryError = (): MultiLangError => NewError(ErrorName.FAIL_TO_SUMMARY, 500)
export const SaveReportError = (): MultiLangError => NewError(ErrorName.SAVE_REPORT_ERROR, 500)
export const UnknownBindUserError = (): MultiLangError => NewError(ErrorName.UNKNOWN_BIND_USER_ERROR, 400)
export const ExistsUserNameError = (): MultiLangError => NewError(ErrorName.EXISTS_USER_NAME_ERROR, 400)
export const NeedCreateUsernameError = (): MultiLangError => NewError(ErrorName.NEED_CREATE_ACCOUNT_NAME, 400)
export const RequestAppleAuthFail = (): MultiLangError => NewError(ErrorName.REUQEST_APPLE_AUTH_FAIL, 500)
export const UnverifiedEmailError = (): MultiLangError => NewError(ErrorName.UNVERIFIED_EMAIL, 400)
export const FetchThreePartyError = (detail?: string): MultiLangError => {
  const error = NewError(ErrorName.FETCH_THREE_PRATRY_ERROR, 500)
  if (detail) error.message = `${error.message}: ${detail}`
  return error
}
export const StripeSignCheckFail = (): MultiLangError => NewError(ErrorName.STRIPE_SIGN_CHECK_FAIL, 400)
export const SaveStripeEventFail = (): MultiLangError => NewError(ErrorName.SAVE_STRIPE_EVENT_FAIL, 500)
export const UnknownStripePriceId = (): MultiLangError => NewError(ErrorName.UNKNOWN_STRIPE_PRICE_ID, 400)
export const SubscriptionNotExpired = (): MultiLangError => NewError(ErrorName.SUBSCRIPTION_NOT_EXPIRED, 400)
export const InternetSearchFail = (): MultiLangError => NewError(ErrorName.INTERNET_SEARCH_FAIL, 500)
export const AIRateLimitError = (): MultiLangError => NewError(ErrorName.AI_RATE_LIMIT, 429)
export const AIError = (): MultiLangError => NewError(ErrorName.AI_ERROR, 500)
export const NotSubscriptionError = (): MultiLangError => NewError(ErrorName.NOT_SUBSCRIPTION, 403)
export const AIContentHarmful = (): MultiLangError => NewError(ErrorName.AI_CONTENT_HARMFUL, 400)
export const CreateBookmarkShareUniqueFail = (): MultiLangError => NewError(ErrorName.CREATE_BOOKMARK_SHARE_UNIQUE_FAIL, 400)
export const ShareDisabledError = (): MultiLangError => NewError(ErrorName.SHARE_DISABLED, 400)
export const ShareCodeNotFoundError = (): MultiLangError => NewError(ErrorName.SHARE_CODE_NOT_FOUND, 400)
export const ShareActionNotAllowedError = (): MultiLangError => NewError(ErrorName.SHARE_ACTION_NOT_ALLOWED, 400)
export const ErrorMarkTypeError = (): MultiLangError => NewError(ErrorName.ERROR_MARK_TYPE, 400)
export const MarkLineTooLongError = (): MultiLangError => NewError(ErrorName.MARK_LINE_TOO_LONG, 400)
export const ErrorMarkCommentTypeError = (): MultiLangError => NewError(ErrorName.ERROR_MARK_COMMENT_TYPE, 400)
export const ReadabilityParseError = (): MultiLangError => NewError(ErrorName.READABILITY_PARSE_ERROR, 500)
export const CommentTooLongError = (): MultiLangError => NewError(ErrorName.COMMENT_TOO_LONG, 400)
export const ImportTaskExistsError = (): MultiLangError => NewError(ErrorName.IMPORT_TASK_EXISTS, 400)
export const SummaryUpdateReachLimitError = (): MultiLangError => NewError(ErrorName.SUMMARY_UPDATE_REACH_LIMITED, 400)
export const VectorizeFailedError = (): MultiLangError => NewError(ErrorName.VECTORIZE_FAILED, 500)
export const EmailDailyLimitError = (): MultiLangError => NewError(ErrorName.EMAIL_DAILY_LIMIT, 400)
export const EmailVerifyCodeExistsError = (): MultiLangError => NewError(ErrorName.EMAIL_VERIFY_CODE_EXISTS, 400)
export const EmailVerifyCodeError = (): MultiLangError => NewError(ErrorName.EMAIL_VERIFY_CODE_ERROR, 400)
export const EmailVerifyCodeRateLimitError = (): MultiLangError => NewError(ErrorName.EMAIL_VERIFY_CODE_RATE_LIMIT, 400)
export const TooManyRequestsError = (): MultiLangError => NewError(ErrorName.TOO_MANY_REQUESTS, 429)
export const QuotaExceededError = (): MultiLangError => NewError(ErrorName.QUOTA_EXCEEDED, 418)
export const ErrorConnectionParam = (): MultiLangError => NewError(ErrorName.ERROR_CONNECTION_PARAM, 400)
export const ShareCollectionNotFoundError = (): MultiLangError => NewError(ErrorName.SHARE_COLLECTION_NOT_FOUND, 404)
export const ShareCollectionNotSupportPriceChangeError = (): MultiLangError => NewError(ErrorName.SHARE_COLLECTION_NOT_SUPPORT_PRICE_CHANGE, 400)
export const ShareCollectionAlreadySubscribedError = (): MultiLangError => NewError(ErrorName.SHARE_COLLECTION_ALREADY_SUBSCRIBED, 400)
export const ShareCollectionNotSubscribedError = (): MultiLangError => NewError(ErrorName.SHARE_COLLECTION_NOT_SUBSCRIBED, 400)
export const ShareCollectionExpiredError = (): MultiLangError => NewError(ErrorName.SHARE_COLLECTION_EXPIRED, 400)
export const ShareCollectionUpdatePriceFailError = (): MultiLangError => NewError(ErrorName.SHARE_COLLECTION_UPDATE_PRICE_FAIL, 400)
export const ShareCollectionClosedError = (): MultiLangError => NewError(ErrorName.SHARE_COLLECTION_CLOSED, 400)
export const ShareCollectionNotAllowedError = (): MultiLangError => NewError(ErrorName.SHARE_COLLECTION_NOT_ALLOWED, 400)
export const NotAllowedEmailError = (): MultiLangError => NewError(ErrorName.NOT_ALLOWED_EMAIL, 400)
export const StripeCancelSubscriptionError = (): MultiLangError => NewError(ErrorName.STRIPE_CANCEL_SUBSCRIPTION_ERROR, 400)
export const RecoverSubscribeError = (): MultiLangError => NewError(ErrorName.RECOVER_SUBSCRIBE_ERROR, 400)
export const ShareCollectionCantUpdateFreeError = (): MultiLangError => NewError(ErrorName.SHARE_COLLECTION_CANT_UPDATE_FREE, 400)
export const NotHaveStripeAccountError = (): MultiLangError => NewError(ErrorName.NOT_HAVE_STRIPE_ACCOUNT_ERROR, 400)
export const RedeemCodeNotFoundOrUsedError = (): MultiLangError => NewError(ErrorName.REDEEM_CODE_NOT_FOUND_OR_USED, 400)
export const BookmarkChangesSyncTooOldError = (): MultiLangError => NewError(ErrorName.BOOKMARK_CHANGES_SYNC_TOO_OLD, 501)
export const ImportOtherTimeoutError = (): MultiLangError => NewError(ErrorName.IMPORT_OTHER_TIMEOUT, 500)
export const ReceiveActivityTypeNotFoundError = (): MultiLangError => NewError(ErrorName.RECEIVE_ACTIVITY_TYPE_NOT_FOUND, 400)
export const ReceiveActivityAlreadyReceivedError = (): MultiLangError => NewError(ErrorName.RECEIVE_ACTIVITY_ALREADY_RECEIVED, 400)
export const HasUnfinishedImportTaskError = (): MultiLangError => NewError(ErrorName.HAS_UNFINISHED_IMPORT_TASK, 400)
export const TooManyImportTasksError = (): MultiLangError => NewError(ErrorName.TOO_MANY_IMPORT_TASKS, 400)
export const ReadabilityParseNoParserError = (): MultiLangError => NewError(ErrorName.READABILITY_PARSE_NO_PARSER, 500)
export const ReadabilityParseWeixinCallbackFailError = (): MultiLangError => NewError(ErrorName.READABILITY_PARSE_WEIXIN_CALLBACK_FAIL, 500)
export const PuppeteerTimeoutError = (): MultiLangError => NewError(ErrorName.PUPPETEER_TIMEOUT, 500)
export const ZyteTimeoutError = (): MultiLangError => NewError(ErrorName.ZYTE_TIMEOUT, 500)
export const WeixinEnvAbnormalError = (): MultiLangError => NewError(ErrorName.WEIXIN_ENV_ABNORMAL, 500)
export const DajialaArticleUnavailableError = (detail?: string): MultiLangError => {
  const error = NewError(ErrorName.DAJIALA_ARTICLE_UNAVAILABLE, 500)
  if (detail) error.message = `${error.message}: ${detail}`
  return error
}
export const DeleteImportFailedBookmarkFailError = (): MultiLangError => NewError(ErrorName.DELETE_IMPORT_FAILED_BOOKMARK_FAIL, 400)
export const BookmarkContentNotFoundError = (): MultiLangError => NewError(ErrorName.BOOKMARK_CONTENT_NOT_FOUND, 404)
export const BookmarkOverviewContentError = (): MultiLangError => NewError(ErrorName.BOOKMARK_OVERVIEW_CONTENT_ERROR, 500)
export const AccountDeletionNotAllowedError = (reason?: string): MultiLangError => {
  const error = NewError(ErrorName.ACCOUNT_DELETION_NOT_ALLOWED, 400)
  if (reason) error.message = `${error.message}: ${reason}`
  return error
}
export const UserAccountDeletedError = (): MultiLangError => NewError(ErrorName.USER_ACCOUNT_DELETED, 401)
export const AccountNotAllowRegisterError = (remeninTimes: string): MultiLangError => {
  const error = NewError(ErrorName.USER_ACCOUNT_DELETED, 403)
  error.message = `${error.message}, please try again after ${remeninTimes}`
  return error
}
export const AppleIAPProductMismatchError = (): MultiLangError => NewError(ErrorName.APPLE_IAP_PRODUCT_MISMATCH, 400)

export const PlatformAlreadyBoundError = (): MultiLangError => NewError(ErrorName.PLATFORM_ALREADY_BOUND, 400)

export const OAuth2StateExpiredError = (): MultiLangError => NewError(ErrorName.OAUTH2_STATE_EXPIRED, 400)

export const OAuth2StateInvalidError = (): MultiLangError => NewError(ErrorName.OAUTH2_STATE_INVALID, 400)

export const OAuth2TokenExchangeError = (): MultiLangError => NewError(ErrorName.OAUTH2_TOKEN_EXCHANGE_ERROR, 500)

export const OAuth2UserInfoError = (): MultiLangError => NewError(ErrorName.OAUTH2_USER_INFO_ERROR, 500)

export const PlatformAccountBoundToOtherUserError = (): MultiLangError => NewError(ErrorName.PLATFORM_ACCOUNT_BOUND_TO_OTHER_USER, 400)

export const InvalidApiKeyError = (): MultiLangError => NewError(ErrorName.INVALID_API_KEY, 401)

export const ApiKeyNotFoundError = (): MultiLangError => NewError(ErrorName.API_KEY_NOT_FOUND, 404)

export const ApiKeyRevokedError = (): MultiLangError => NewError(ErrorName.API_KEY_REVOKED, 403)

export const ApiKeyLimitExceededError = (): MultiLangError => NewError(ErrorName.API_KEY_LIMIT_EXCEEDED, 400)

export const ApiKeyRouteNotAllowedError = (): MultiLangError => NewError(ErrorName.API_KEY_ROUTE_NOT_ALLOWED, 403)

export const ProhibitedContentError = (): MultiLangError => NewError(ErrorName.PROHIBITED_CONTENT, 400)
export const ShareContentNotSupportedError = (): MultiLangError => NewError(ErrorName.SHARE_CONTENT_NOT_SUPPORTED, 400)
export const SyncTableRuleError = (): MultiLangError => NewError(ErrorName.SYNC_TABLE_RULE_ERROR, 400)
export const SyncTableTagNameError = (): MultiLangError => NewError(ErrorName.SYNC_TABLE_TAG_NAME_ERROR, 400)
/** Message carries the feature's display name so clients can show it as-is. */
export const LabFeatureDisabledError = (featureName: { [lang in Language]?: string }): MultiLangError => {
  const messages = loadErrorMessages(ErrorName.LAB_FEATURE_DISABLED)
  for (const lang of Object.keys(messages) as Language[]) {
    messages[lang] = (messages[lang] || '').replace('{feature}', featureName[lang] || featureName.en || '')
  }
  return new MultiLangError(ErrorName.LAB_FEATURE_DISABLED, 400, messages)
}
