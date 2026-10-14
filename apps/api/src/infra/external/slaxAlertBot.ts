import { singleton } from '../../decorators/di'

export type EnvLabel = 'local' | 'test' | 'beta' | 'prod'

export const resolveEnvLabel = (env: Env): EnvLabel => {
  if (env.RUN_TYPE === 'prod') return 'prod'
  if (env.RUN_TYPE === 'beta') return 'beta'
  return (env.RUN_ENV as string) === 'development' ? 'local' : 'test'
}

const pushWeComMessage = async (url: string, str: string) => {
  const resp = (await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        content: str
      }
    })
  })) as Response
  console.log(`push:`, await resp.text())
}

// 话题群专用：第一行作为卡片 header（即话题标题），其余内容作为正文
const pushFeiShuTopicMessage = async (url: string, str: string) => {
  const firstNewline = str.indexOf('\n')
  const title = firstNewline > 0 ? str.substring(0, firstNewline) : str
  const content = firstNewline > 0 ? str.substring(firstNewline + 1).trim() : ''

  // 根据首字符 emoji 选择 header 颜色
  let template = 'red'
  if (title.startsWith('✅')) template = 'green'
  else if (title.startsWith('⚠️')) template = 'orange'
  else if (title.startsWith('🔍')) template = 'blue'
  else if (title.startsWith('⏭️')) template = 'yellow'

  const card: Record<string, unknown> = {
    header: {
      title: { tag: 'plain_text', content: title },
      template
    },
    config: { wide_screen_mode: true },
    elements: content ? [{ tag: 'div', text: { tag: 'lark_md', content } }] : []
  }

  const resp = (await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'interactive', card })
  })) as Response
  console.log(`push topic:`, await resp.text())
}

const pushFeiShuMessage = async (url: string, str: string) => {
  const resp = (await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      msg_type: 'interactive',
      card: {
        config: {
          wide_screen_mode: true
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: str
            }
          }
        ]
      }
    })
  })) as Response
  console.log(`push:`, await resp.text())
}

const withEnvTag = (str: string, label: EnvLabel): string => {
  const tag = `【${label.toUpperCase()}】`
  const firstNewline = str.indexOf('\n')
  if (firstNewline < 0) return `${str} ${tag}`
  return `${str.substring(0, firstNewline)} ${tag}${str.substring(firstNewline)}`
}

@singleton()
export class SlaxAlertBotClient {
  private urlMap: Record<string, string | undefined> = {}
  private envLabel: EnvLabel
  private senderMap: Record<string, (url: string, str: string) => Promise<void>> = {
    report: pushFeiShuMessage,
    crawl: pushFeiShuTopicMessage
  }

  constructor(env: Env) {
    this.envLabel = resolveEnvLabel(env)
    this.urlMap = {
      stripe: env.STRIPE_PUSH_API,
      report: env.REPORT_PUSH_API,
      error: env.ERROR_LOG_PUSH_API,
      crawl: env.CRAWL_PUSH_API
    }
    this.initializeBots()
  }

  private initializeBots() {
    ;(Object.keys(this.urlMap) as string[]).forEach(botName => {
      const sender = this.senderMap[botName] || pushWeComMessage
      const tagged = botName === 'crawl'
      ;(this as any)[botName] = {
        pushMessage: async (str: string) => {
          const url = this.urlMap[botName]?.trim()
          if (!url || this.envLabel === 'local') return
          let destination: URL
          try {
            destination = new URL(url)
          } catch {
            throw new Error('Invalid alert webhook URL')
          }
          if (destination.protocol !== 'https:' || destination.username || destination.password || destination.hash) {
            throw new Error('Alert webhook must be an HTTPS URL without credentials or fragment')
          }
          const content = tagged ? withEnvTag(str, this.envLabel) : str
          await sender(url, content)
        }
      }
    })
  }

  [key: string]:
    | {
        pushMessage: (str: string) => Promise<void>
      }
    | any
}
