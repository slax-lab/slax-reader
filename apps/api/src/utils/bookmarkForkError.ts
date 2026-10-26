import { ErrorName } from '@slax-reader/contracts'
import { MultiLangError } from '@/utils/multiLangError'

const messages = {
  [ErrorName.FORK_SOURCE_NOT_READY]: ['This snapshot is not ready to copy. Try again later.', '这篇收藏尚未准备好，请稍后重试。'],
  [ErrorName.FORK_DESTINATION_IN_PROGRESS]: ['Your existing save is still processing.', '你已有的收藏仍在处理中。'],
  [ErrorName.FORK_DESTINATION_DELETING]: ['Your previous save is being deleted. Try again later.', '之前的收藏正在删除，请稍后重试。'],
  [ErrorName.FORK_DESTINATION_FAILED]: ['Your existing save failed. Retry or remove it first.', '已有收藏处理失败，请先重试或删除它。'],
  [ErrorName.FORK_STORAGE_UNAVAILABLE]: ['The copy could not be confirmed. Please retry.', '暂时无法确认复制结果，请重试。']
} as const

export function forkError(name: keyof typeof messages = ErrorName.FORK_SOURCE_NOT_READY) {
  const [en, zh] = messages[name]
  return new MultiLangError(name, name === ErrorName.FORK_STORAGE_UNAVAILABLE ? 503 : 409, { en, zh })
}
