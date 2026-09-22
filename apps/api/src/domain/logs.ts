import { inject, singleton } from '../decorators/di'
import { LogsRepo } from '../infra/repository/dbLogs'

@singleton()
export class LogsService {
  constructor(@inject(LogsRepo) private logsRepo: LogsRepo) {}

  async track(userId: number, eventName: string, extraData?: Record<string, unknown>): Promise<void> {
    try {
      await this.logsRepo.insertLog(userId, eventName, extraData)
    } catch (e) {
      console.error(`[LogsService] failed to track ${eventName}:`, e)
    }
  }
}
