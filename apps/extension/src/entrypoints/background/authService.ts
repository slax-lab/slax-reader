import type { SessionService } from './sessionService'
import type { UserInfo } from '@slax-reader/contracts/interface'

export class AuthService {
  constructor(
    private sessionService: SessionService,
    private requireLogin: () => Promise<void>,
    private loadUserInfo: () => Promise<UserInfo | null>,
    private matchesSession: (userInfo: UserInfo) => Promise<boolean>
  ) {}

  private userInfoLoadInFlight: Promise<UserInfo | null> | null = null

  async checkLogin(): Promise<boolean> {
    if (await this.sessionService.hasSession()) return true
    await this.requireLogin()
    return false
  }

  async queryUserInfo(): Promise<UserInfo | null> {
    if (!(await this.sessionService.hasSession())) return null
    if (this.userInfoLoadInFlight) return this.userInfoLoadInFlight

    this.userInfoLoadInFlight = this.loadUserInfo().then(async result => {
      return result && (await this.matchesSession(result)) ? result : null
    }).finally(() => {
      this.userInfoLoadInFlight = null
    })
    return this.userInfoLoadInFlight
  }
}
