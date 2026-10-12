import { inject, injectable } from '@/decorators/di'
import { CommandContext, InlineKeyboard, NextFunction, ReactionContext, Bot, Context } from 'grammy'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { UserRepo, platformBindType } from '@/infra/repository/dbUser'
import { Hashid } from '@/utils/hashids'
import { hashSHA256 } from '@/utils/strings'
import { URLPolicie } from '@/utils/urlPolicie'
import { i18n } from '@/const/i18n'

export interface callbackPayload {
  chat_id: number
  origin_message_id: number
}

export interface TelegramReplyMessageResp {
  url: string
  chatId: number
  msgId: number
  userId: number
}

@injectable()
export class TelegramBotService {
  private bot!: Bot
  private env!: Env
  private t = i18n('en')

  constructor(
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo
  ) {}

  public async initTelegramBot(env: Env): Promise<Bot> {
    this.env = env
    this.bot = await this.getBot(env)
    return this.bot
  }

  private async getBot(env: Env) {
    //@ts-ignore
    const isProd = env.RUN_TYPE === 'prod'
    const client = isProd
      ? {
          apiRoot: env.SLAX_READER_BOT_API_ROOT
        }
      : undefined
    return new Bot(env.TELEGRAM_BOT_TOKEN, {
      client: client,
      botInfo: {
        is_bot: true,
        username: env.SLAX_READER_BOT_NAME,
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        id: parseInt(env.SLAX_READER_BOT_ID),
        first_name: env.SLAX_READER_BOT_NAME,
        has_main_web_app: false
      }
    })
  }

  /** 拒绝其他回复 */
  public async notSupportType(ctx: Context) {
    if (!ctx.message || !ctx.message.text) return await ctx.reply(this.t.telegramNotSupportType({}))
  }

  /** 检查消息格式 */
  public async checkFromId(ctx: Context, next: NextFunction) {
    if (!ctx.from) return await ctx.reply(this.t.telegramNotTelegramId({}))
    const promises = []
    if (ctx.hasCommand(['start', 'help', 'me', 'list', 'topics'])) {
      promises.push(this.bot.api.setMessageReaction(ctx.chat.id, ctx.msgId, [{ type: 'emoji', emoji: '🥰' }]))
    }
    promises.push(next())
    await Promise.allSettled(promises)
  }

  public async replyText(ctx: Context) {
    const telegramId = ctx.from?.id || 0
    const text = ctx.msg?.text || ''

    const match = text.match(`(https?)://[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]`)
    if (!match || match.length < 1) return

    const url = new URL(match[0])
    const policie = new URLPolicie(this.env, url)
    if (policie.isBlocked()) {
      await ctx.reply(this.t.telegramBlockedUrl({}))
      return
    }

    try {
      const user = await this.userRepo.getUserByPlatform('telegram', String(telegramId))
      return {
        url: url.toString(),
        chatId: ctx.chatId,
        msgId: ctx.msgId,
        userId: user.user_id
      } as TelegramReplyMessageResp
    } catch (err) {
      console.log(`[TELEGRAM] getUserByPlatform error: ${err}`)
      await ctx.reply(this.t.telegramBindGuide({ base_front_end_url: this.env.FRONT_END_URL }), {
        parse_mode: 'HTML'
      })
      return
    }
  }

  public async commandStart(ctx: CommandContext<Context>) {
    const args = ctx.match.split('-')
    if (args.length < 2) return await ctx.reply(this.t.telegramStartGuide({}))

    const enUserId = parseInt(args[0])
    const token = args.slice(1).join('')
    const hashIds = new Hashid(this.env)
    const userId = hashIds.decodeId(enUserId)
    if (!userId) return await ctx.reply('🚫 User not found')

    const checkToken = (await hashSHA256(String(userId) + this.env.IMAGER_CHECK_DIGST_SALT)).substring(0, 50)
    if (!userId || !token || checkToken !== token || !ctx.from?.id) return await ctx.reply('🚫 User not found')

    const platformName = ctx.from?.username || ctx.from?.first_name || '' + ctx.from?.last_name || ''
    await this.userRepo.userBindPlatform(userId, platformBindType.TELEGRAM, String(ctx.from.id), platformName)
    await Promise.all([ctx.react('🎉'), ctx.reply(this.t.telegramBindSuccess({}))])
  }

  public async commandHelp(ctx: CommandContext<Context>) {
    await ctx.reply(this.t.telegramHelpGuide({}))
  }

  public async commandMe(ctx: CommandContext<Context>) {
    const telegramId = ctx.from?.id
    if (!telegramId) return await ctx.reply(this.t.telegramNotTelegramId({}))
    const user = await this.userRepo.getUserByPlatform('telegram', String(telegramId))
    if (user instanceof Error || !user) {
      return await ctx.reply(this.t.telegramBindGuide({ base_front_end_url: this.env.FRONT_END_URL }), {
        parse_mode: 'HTML'
      })
    }

    const mssage = this.t.telegramUserInfo({
      chat_id: ctx.chatId,
      msg_id: ctx.msgId,
      username: ctx.from?.username,
      first_name: ctx.from?.first_name,
      last_name: ctx.from?.last_name,
      language_code: ctx.from?.language_code,
      platform_id: telegramId,
      slax_name: user.user_name
    })

    await ctx.reply(mssage)
  }

  public async commandList(ctx: CommandContext<Context>) {
    await this.showPage(ctx, ctx.chat?.id, 0, 1, 10, 0)
  }

  private async createTopicKeyboard(userId: number, language: string) {
    const tags = await this.bookmarkRepo.getUserTags(userId)
    const keyboard = new InlineKeyboard()
    if (tags instanceof Error) return keyboard

    for (let i = 0; i < tags.length; i += 2) {
      const firstTag = tags[i]
      const secondTag = i + 1 < tags.length ? tags[i + 1] : null

      const firstTagName = `🔖 ${firstTag.tag_name}`
      keyboard.text(`${firstTagName}`, `bookmark_list-${firstTag.id}`)

      if (secondTag) {
        const secondTagName = `🔖 ${secondTag.tag_name}`
        keyboard.text(`${secondTagName}`, `bookmark_list-${secondTag.id}`)
      }
      keyboard.row()
    }

    return keyboard
  }

  public async commandTopics(ctx: CommandContext<Context>) {
    const user = await this.userRepo.getUserByPlatform('telegram', String(ctx.from?.id))
    if (user instanceof Error || !user || !user.user_id) {
      return await ctx.reply(this.t.telegramBindGuide({ base_front_end_url: this.env.FRONT_END_URL }), {
        parse_mode: 'HTML'
      })
    }

    const language = ctx.from?.language_code?.substring(0, 2) || 'en'
    const kb = await this.createTopicKeyboard(user.user_id, language)
    await ctx.reply('🏷️ Topics', {
      reply_markup: kb
    })
  }

  public async sendProcessSuccess(ctx: Context, encodeBmId: number, payload: callbackPayload) {
    const replyText = this.t.telegramCallbackSuccess({ click: `<a href="${this.env.FRONT_END_URL}/bookmarks/${encodeBmId}">click here</a>` })
    const msgPromise = this.bot.api.sendMessage(payload.chat_id, replyText, {
      parse_mode: 'HTML'
    })
  }

  public async handlePaginationCallback(ctx: Context) {
    const action = ctx.callbackQuery?.data
    if (!action || !ctx.chatId || !ctx.msgId) return ctx.answerCallbackQuery()

    const command = action.split('-')
    if (!command) return ctx.answerCallbackQuery()
    if (command[0] === 'bookmark_list') {
      const tagId = parseInt(command[1])
      await this.showPage(ctx, ctx.chatId, ctx.msgId, 1, 10, tagId)
    } else if (['prev', 'next'].includes(command[0])) {
      if (command.length === 2) {
        await this.showPage(ctx, ctx.chatId, ctx.msgId, parseInt(command[1]), 10, 0)
      } else if (command.length === 3) {
        await this.showPage(ctx, ctx.chatId, ctx.msgId, parseInt(command[2]), 10, parseInt(command[1]))
      }
    }
    await ctx.answerCallbackQuery()
  }

  public async getDataList(userId: number, page: number, size: number, tagId: number) {
    const hashIds = new Hashid(this.env, userId)
    let resp = []
    let tagName = ''
    if (tagId) {
      const tag = await this.bookmarkRepo.getUserTagById(userId, tagId)
      if (tag instanceof Error) return { data: [], tagName: '' }
      if (!tag) return { data: [], tagName: '' }
      resp = await this.bookmarkRepo.listUserBookmarksByTagIds(userId, [tagId], (page - 1) * size, size)
      tagName = tag.tag_name
    } else {
      resp = await this.bookmarkRepo.listUserBookmarks(userId, (page - 1) * size, size, '')
    }
    return {
      data: resp.map((item, idx) => {
        if (!item || !item.bookmark) return ''
        const isShortcut = 'type' in item && item.type === 1
        const url = isShortcut ? item.bookmark.target_url : `${this.env.FRONT_END_URL}/bookmarks/${hashIds.encodeId(item.bookmark_id)}`
        return `<a href="${url}">${idx + 1}. ${item.bookmark.title}</a>`
      }),
      tagName: tagName
    }
  }

  public async showPage(ctx: Context, chatId: number, messageId: number, page: number, size: number, tagId: number) {
    let t1 = new Date()
    const user = await this.userRepo.getUserByPlatform('telegram', String(ctx.from?.id))
    console.log(`[TELEGRAM] getUserByPlatform time: ${new Date().getTime() - t1.getTime()}ms`)
    t1 = new Date()
    if (user instanceof Error || !user || !user.user_id) {
      return await ctx.reply(this.t.telegramBindGuide({ base_front_end_url: this.env.FRONT_END_URL }), {
        parse_mode: 'HTML'
      })
    }

    const { data, tagName } = await this.getDataList(user.user_id, page, size, tagId)
    const header = tagName ? `📚 Bookmark #${tagName} List` : `📚 Bookmark List`
    const messages = [header, ...data]
    console.log(`[TELEGRAM] getDataList time: ${new Date().getTime() - t1.getTime()}ms`)

    const button = this.generatePaginationButtons(page, messages.length > 0, tagId)

    t1 = new Date()
    if (messageId < 1) {
      await ctx.reply(messages.join('\n\n'), {
        parse_mode: 'HTML',
        reply_markup: button
      })
    } else {
      await ctx.api.editMessageText(chatId, messageId, messages.join('\n\n'), {
        parse_mode: 'HTML',
        reply_markup: button
      })
    }
    console.log(`[TELEGRAM] replyMessage time: ${new Date().getTime() - t1.getTime()}ms`)
  }

  public generatePaginationButtons(page: number, hasData: boolean, tagId: number): InlineKeyboard {
    const keyboard = new InlineKeyboard()
    if (page > 1) keyboard.text('Previous', `prev-${tagId}-${page - 1}`)
    if (hasData) keyboard.text('Next', `next-${tagId}-${page + 1}`)
    return keyboard
  }

  public async replyReaction(ctx: ReactionContext<Context>) {
    await ctx.reply('🔥')
  }

  public async callback(encodeBmId: number, payload: callbackPayload) {
    // 使用markdown回复
    const click = `<a href="${this.env.FRONT_END_URL}/bookmarks/${encodeBmId}">click here</a>`
    const replyText = this.t.telegramCallbackSuccess({ click })
    const msgPromise = this.bot.api.sendMessage(payload.chat_id, replyText, {
      parse_mode: 'HTML'
    })
    const reactionPromise = this.bot.api.setMessageReaction(payload.chat_id, payload.origin_message_id, [
      {
        type: 'emoji',
        emoji: '🍾'
      }
    ])
    await Promise.all([msgPromise, reactionPromise])
  }
}
