import { ErrorName } from '../const/err'

export type Language = 'en' | 'es' | 'zh'

let currentLanguage: Language = 'en'

export const setGlobalLanguage = (lang: string) => {
  currentLanguage = (lang as Language) || 'en'
}

export class MultiLangError extends Error {
  public errCode: number
  private messages: { [lang in Language]?: string }

  constructor(errType: ErrorName, errCode: number, messages: { [lang in Language]?: string }) {
    super(messages['en'] || 'Unknown error')
    this.messages = messages
    this.name = errType
    this.errCode = errCode
  }

  get getMessage(): string {
    return this.messages[currentLanguage] || this.messages['en'] || 'Unknown error'
  }
}
