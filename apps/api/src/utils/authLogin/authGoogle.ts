import { GoogleSSOError, GoogleSSOAudError } from '../../const/err'
import { createRemoteJWKSet, jwtVerify } from 'jose'
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
interface tokenInfo {
  iss: string
  sub: string
  azp: string
  aud: string
  iat: string
  exp: string
  email: string
  email_verified: string
  name: string
  picture: string
  given_name: string
  family_name: string
  locale: string
  nonce?: string
}
interface codeInfo {
  id_token: string
  error?: string
  error_description?: string
}
export class GoogleAuth {
  private clientId: string
  private clientSecret: string
  private platform: string

  constructor(env: Env, platform: string) {
    this.platform = platform
    switch (platform) {
      case 'ios':
        this.clientId = (env as Env & { GOOGLE_IOS_CLIENT_ID_TEXT?: string }).GOOGLE_IOS_CLIENT_ID_TEXT || ''
        this.clientSecret = ''
        break
      case 'android':
        this.clientId = env.GOOGLE_ANDROID_CLIENT_ID_TEXT
        this.clientSecret = ''
        break
      case 'web':
        this.clientId = env.GOOGLE_CLIENT_ID_TEXT
        this.clientSecret = env.GOOGLE_CLIENT_SECRET_TEXT
        break
      default:
        console.error(`[login] rejected: unsupported google platform ${JSON.stringify({ platform })}`)
        throw GoogleSSOAudError()
    }
    if (!this.clientId || (platform !== 'web' && this.clientId === env.GOOGLE_CLIENT_ID_TEXT)) {
      console.error(
        `[login] rejected: google client id unusable ${JSON.stringify({ platform, clientId: this.clientId || null, hasClientSecret: !!this.clientSecret, usesWebClientId: !!this.clientId && this.clientId === env.GOOGLE_CLIENT_ID_TEXT })}`
      )
      throw GoogleSSOAudError()
    }
  }
  verifyGoogleToken = async (idToken: string): Promise<tokenInfo> => {
    try {
      const { payload } = await jwtVerify(idToken, googleKeys, {
        issuer: ['accounts.google.com', 'https://accounts.google.com'],
        audience: this.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat', 'email', 'email_verified']
      })
      if (!payload.sub || typeof payload.email !== 'string' || !payload.email || String(payload.email_verified) !== 'true') throw GoogleSSOError()
      if (payload.aud !== this.clientId) throw GoogleSSOAudError()
      if (this.platform === 'web' && payload.azp !== undefined && payload.azp !== this.clientId) throw GoogleSSOAudError()
      return payload as unknown as tokenInfo
    } catch (error) {
      console.error(
        `[login] rejected: google id_token verification failed ${JSON.stringify({ expectedAud: this.clientId, reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })}`
      )
      throw GoogleSSOError()
    }
  }
  async getToken(code: string, redirectUri: string): Promise<codeInfo> {
    let detail: Record<string, unknown> = { clientId: this.clientId || null, hasClientSecret: !!this.clientSecret, redirectUri }
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId, code, grant_type: 'authorization_code', client_secret: this.clientSecret, redirect_uri: redirectUri })
      })
      const result = await res.json<codeInfo>().catch(() => null)
      detail = { ...detail, status: res.status, error: result?.error, description: result?.error_description }
      if (!res.ok || !result || result.error || !result.id_token) throw GoogleSSOError()
      return result
    } catch (error) {
      console.error(
        `[login] rejected: google token exchange failed ${JSON.stringify({ ...detail, reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })}`
      )
      throw GoogleSSOError()
    }
  }
  async loginWithGoogle(code: string, redirectUri: string): Promise<tokenInfo> {
    const token = await this.getToken(code, redirectUri)
    return await this.verifyGoogleToken(token.id_token)
  }
}
