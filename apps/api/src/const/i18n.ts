const templates = {
  commentToYouTitle: {
    zh: '💬 {user_name} 留下了评论',
    en: '💬 {user_name} commented on you'
  },
  replyToYouTitle: {
    zh: '📝 {user_name} 发表了看法',
    en: '📝 {user_name} express an opinion'
  },
  welcomeUser: {
    zh: '🎉 欢迎 {user_name} 加入 Slax Reader！',
    en: '🎉 Welcome {user_name} to join Slax Reader!'
  },
  hasNewCollectionSubscriber: {
    zh: '🎉 {user_name} 订阅了你的星标合集“{collection_name}”',
    en: '🎉 {user_name} is now following "{collection_name}"'
  },
  cancelCollectionSubscribe: {
    zh: '{user_name} 停止订阅你的星标合集“{collection_name}”了',
    en: '{user_name} is no longer following "{collection_name}"'
  },
  collectionHasNewContent: {
    zh: '📚 你订阅的“{collection_name}”有新内容了',
    en: '📚 New in "{collection_name}"'
  },
  telegramStartGuide: {
    zh: '',
    en: '👋🏻 Hi! Welcome to the Slax Reader Telegram Bot. Send me a link, and I’ll save it for you to read later!'
  },
  telegramHelpGuide: {
    zh: '',
    en: '👋🏻 Hi! Welcome to the Slax Reader Telegram Bot. Send me a link, and I’ll save it for you to read later!'
  },
  telegramBindSuccess: {
    zh: '',
    en: '🎉 The account binding is successful, you can send the link to help you analyze it'
  },
  telegramBindGuide: {
    zh: '',
    en: '👋🏻 Hi~ You have not yet bound it. Please click <a href="{base_front_end_url}">the link</a> or bind it in your personal centre and then continue to use it.'
  },
  telegramNotSupportType: {
    zh: '',
    en: '🚫 Sorry, this type is not yet supported. We will add support for it as soon as possible.'
  },
  telegramNotTelegramId: {
    zh: '',
    en: '🚫 Not Telegram ID'
  },
  telegramBlockedUrl: {
    zh: '',
    en: '🚫 URL Blocked'
  },
  telegramBookmarkError: {
    zh: '🚫 收藏失败，请稍后再试',
    en: '🚫 Bookmark Error'
  },
  telegramLabFeatureDisabled: {
    zh: '🧪 {message}\n打开实验室：<a href="{base_front_end_url}/user">设置页</a>',
    en: '🧪 {message}\nOpen Labs: <a href="{base_front_end_url}/user">Settings</a>'
  },
  telegramUserInfo: {
    zh: '',
    en: '👤 User Info\nChatId: {chat_id}\nMsgId: {msg_id}\nUsername: {username}\nFirst Name: {first_name}\nLast Name: {last_name}\nLanguage Code: {language_code}\nPlatform Id: {platform_id}\nSlax Name: {slax_name}'
  },
  telegramCallbackSuccess: {
    zh: '',
    en: '🎉 Link saved successfully! Click {click} to view it, or use the /list command to see all your saved links.'
  },
  reportPushTemplate: {
    zh: `**🔔 收到了一个 {type}** | [📄 查看原文]({href})\n\n👤 **用户信息**\n📛 **用户**: {name} (🆔 {user_id})\n🌍 **坐标**: {country} (📍 {ip_address})\n📧 **邮箱**: {email}\n📢 **回访**: {allow_follow_up}\n\n🛠 **环境规格**\n💻 **设备**: {platform} · {environment}\n🏷️ **版本**: {version}\n🚪 **入口**: {entry_point}\n\n🎯 **上下文**\n🔖 **书签ID**: {bookmark_id}\n🔗 **目标链接**: {target_url}\n\n📅 **日期**: {date}\n──────────────────\n📝 **反馈内容**:\n{content}`,
    en: ''
  },
  entryPointInbox: {
    zh: '首页列表',
    en: 'Inbox'
  },
  entryPointBookmarkDetail: {
    zh: '书签详情',
    en: 'Bookmark Detail'
  },
  entryPointShare: {
    zh: '分享页面',
    en: 'Share Page'
  },
  entryPointCollection: {
    zh: '合集页面',
    en: 'Collection Page'
  },
  entryPointOriginalWebsite: {
    zh: '原网页',
    en: 'Original Website'
  },
  reportCommonNone: {
    zh: '无',
    en: 'N/A'
  },
  reportAllowFollowUp: {
    zh: '✅ 允许回访',
    en: '✅ Follow-up Allowed'
  },
  reportDenyFollowUp: {
    zh: '❌ 拒绝回访',
    en: '❌ Follow-up Denied'
  },
  receiveActivityResult: {
    // zh: '🎉 免费会员有效期至{end_time}，您现在可以畅享所有高级功能',
    zh: '🎉 Your free trial ends on {end_time}. \nEnjoy all Premium features!',
    en: '🎉 Your free trial ends on {end_time}. \nEnjoy all Premium features!'
  },
  receiveActivityToCreditResult: {
    // zh: '❤️ 已为您充值1个月免费额度，下月订阅自动免单​ ',
    zh: "❤️ We've added a credit to your account - your next monthly subscription will be free.",
    en: "❤️ We've added a credit to your account - your next monthly subscription will be free."
  },
  receiveActivityTitle: {
    // zh: '🎁 领取成功！',
    zh: '🎉 Welcome to Premium!',
    en: '🎉 Welcome to Premium!'
  },
  receiveActivityToCreditTitle: {
    // zh: '🎁 领取成功！',
    zh: '🎁 Free month incoming! ',
    en: '🎁 Free month incoming! '
  },
  receiveActivitySubMessage: {
    // zh: '喜欢Slax Reader吗？分享给朋友一起用！😊',
    zh: 'Enjoying Slax Reader? Share it with friends! 😊 ',
    en: 'Enjoying Slax Reader? Share it with friends! 😊 '
  }
} as const

type ValueOf<T> = T[keyof T]

type ParseTemplate<T extends string> = T extends `${infer _}{${infer Param}}${infer Rest}` ? Param | ParseTemplate<Rest> : never

type TemplateParams<T> = T extends Record<string, infer S> ? (S extends string ? ParseTemplate<S> : never) : never

type TemplateName = keyof typeof templates
type ParamsOf<T extends TemplateName> = Record<TemplateParams<ValueOf<(typeof templates)[T]>>, string>

class I18nTemplate {
  constructor(private lang: 'zh' | 'en') {}

  get proxy(): { [K in TemplateName]: (params: ParamsOf<K>) => string } {
    return new Proxy({} as any, {
      get: (_, key: TemplateName) => (params: ParamsOf<typeof key>) => {
        const template = templates[key][this.lang]
        return template.replace(/\{(\w+)\}/g, (_, key) => params[key as keyof typeof params] || '')
      }
    })
  }
}

const t = (lang: 'zh' | 'en') => new I18nTemplate(lang).proxy

export const i18n = (lang: string) => {
  lang = !!lang ? lang.substring(0, 2) : 'en'
  // only zh and en have templates; anything else (es, ja...) reads the English one
  return t(lang === 'zh' ? 'zh' : 'en')
}
