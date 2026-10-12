import path from 'node:path'
import Conf from 'conf'

interface ConfigSchema {
  apiKey: string
  apiBase: string
}

const config = new Conf<ConfigSchema>({
  projectName: 'reader-cli',
  defaults: {
    apiKey: '',
    apiBase: 'https://api-reader.slax.com',
  },
})

export function getApiKey(): string {
  return config.get('apiKey')
}

export function setApiKey(key: string): void {
  config.set('apiKey', key)
}

export function clearApiKey(): void {
  config.delete('apiKey')
}

export function getApiBase(): string {
  return config.get('apiBase')
}

export function setApiBase(base: string): void {
  config.set('apiBase', base)
}

export function getConfigPath(): string {
  return config.path
}

export function getConfigDir(): string {
  return path.dirname(config.path)
}
