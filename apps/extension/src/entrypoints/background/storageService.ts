import { LocalStorageKey } from '@commons/frontend-types/const'

export class StorageService {
  async clearUserData(): Promise<void> {
    await Promise.allSettled([storage.removeItem(LocalStorageKey.USER_TOKEN), storage.removeItem(LocalStorageKey.USER_INFO)])
  }
}
