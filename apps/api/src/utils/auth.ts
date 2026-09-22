import { RegisterUserError, UnverifiedEmailError } from '../const/err'
import type { userLoginReq } from '../domain/user'
import { AppleAuth } from './authLogin/authApple'
import { GoogleAuth } from './authLogin/authGoogle'

export interface SlaxAuthResult {
  iss: string
  sub: string
  azp: string
  aud: string
  iat: string
  exp: string
  email: string
  email_verified: string
  name?: string
  picture: string
  given_name?: string
  family_name?: string
  locale: string
}

export class SlaxAuth {
  constructor(private env: Env) {}

  async login(req: userLoginReq): Promise<SlaxAuthResult> {
    if (!req || typeof req.code !== 'string' || !req.code) {
      console.error(
        `[login] rejected: missing authorization code ${JSON.stringify({ type: req?.type, platform: req?.platform, hasIdToken: typeof req?.id_token === 'string' && req.id_token.length > 0 })}`
      )
      throw RegisterUserError()
    }
    if (!req.type) req.type = 'google'
    if (!req.platform) req.platform = 'web'
    if (!['google', 'apple'].includes(req.type)) {
      console.error(`[login] rejected: unsupported provider ${JSON.stringify({ type: req.type, platform: req.platform })}`)
      throw RegisterUserError()
    }
    const result = req.type === 'google' ? await this.loginWithGoogle(req) : await this.loginWithApple(req)
    console.log(
      `[login] verified ${JSON.stringify({ provider: req.type, platform: req.platform, sub: result.sub, email: result.email, emailVerified: result.email_verified, aud: result.aud, iss: result.iss })}`
    )
    return result
  }

  private async loginWithGoogle(req: userLoginReq): Promise<SlaxAuthResult> {
    const googleAuth = new GoogleAuth(this.env, req.platform)
    const idToken = req.platform === 'web' ? (await googleAuth.getToken(req.code, req.redirect_uri)).id_token : req.code
    return await googleAuth.verifyGoogleToken(idToken)
  }

  private async loginWithApple(req: userLoginReq): Promise<SlaxAuthResult> {
    const res = await new AppleAuth(this.env, req.platform).loginWithApple(req.code, req.id_token || '', req.client_id || '', req.redirect_uri)
    if (res.email && res.email_verified !== true && res.email_verified !== 'true') throw UnverifiedEmailError()
    const givenName = req.given_name || ''
    const familyName = req.family_name || ''
    const userName = familyName ? `${givenName} ${familyName}`.trim() : givenName || ''
    const email = res.email || `${res.sub}@appleid.apple.com`
    return {
      iss: res.iss,
      sub: res.sub,
      aud: res.aud,
      iat: res.iat,
      exp: res.exp,
      azp: '',
      email,
      email_verified: 'true',
      name: userName,
      picture: '',
      given_name: givenName,
      family_name: familyName,
      locale: 'en'
    }
  }
}
