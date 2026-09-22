import { RequestAppleAuthFail } from '../../const/err'
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose'

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))

export interface AppleIdTokenType {
  iss: string
  sub: string
  aud: string
  exp: string
  iat: string
  nonce: string
  nonce_supported: boolean
  email: string
  email_verified: 'true' | 'false' | boolean
  is_private_email: 'true' | 'false' | boolean
  // 0 （或Unsupported ）、 1 （或Unknown ）、 2 （或Likely Real ）
  real_user_status?: number
}

export interface AppleAuthorizationTokenResponseType {
  access_token: string
  token_type: 'Bearer'
  expires_in: 300
  refresh_token: string
  id_token: string
}

export interface ApplePublicResp {
  keys: AppleKey[]
}

export interface AppleKey {
  kty: string
  kid: string
  use: string
  alg: string
  n: string
  e: string
}

export class AppleAuth {
  private keyId: string
  private teamId: string
  private privateKey: string
  private clientId: string
  private clientIds: string[]

  static algorithm = 'ES256'
  static clientSecretKey = 'apple_client_secret'
  static applePublicKey = 'apple_public_key'
  static ENDPOINT_URL = 'https://appleid.apple.com'

  constructor(env: Env & { APPLE_WEB_CLIENT_ID?: string; APPLE_NATIVE_CLIENT_IDS?: string }, platform = 'web') {
    const webClientId = env.APPLE_WEB_CLIENT_ID?.trim() || ''
    if (platform === 'web') {
      this.clientIds = webClientId ? [webClientId] : []
    } else if (['ios', 'macOS', 'android'].includes(platform)) {
      this.clientIds = (env.APPLE_NATIVE_CLIENT_IDS || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
      if (!webClientId || this.clientIds.includes(webClientId)) throw RequestAppleAuthFail()
    } else {
      throw RequestAppleAuthFail()
    }
    this.clientId = this.clientIds[0] || ''
    if (!this.clientId) throw RequestAppleAuthFail()
    this.keyId = env.APPLE_SIGN_KEY_ID
    this.privateKey = env.APPLE_SIGN_AUTH_KEY
    this.teamId = env.APPLE_SIGN_TEAM_ID
    this.privateKey = this.privateKey
      .replace(/\\n/g, '')
      .replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n')
      .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----')
      .replace(/(.{64})/g, '$1\n')
  }

  //  get client secret
  private async getClientSecret(clientId: string): Promise<string> {
    const header = { alg: AppleAuth.algorithm, kid: this.keyId }
    const privateKey = await importPKCS8(this.privateKey, 'ES256')

    return await new SignJWT()
      .setProtectedHeader(header)
      .setIssuer(this.teamId)
      .setExpirationTime('170days')
      .setIssuedAt()
      .setSubject(clientId)
      .setAudience(AppleAuth.ENDPOINT_URL)
      .sign(privateKey)
  }

  private async getAuthorizationToken(code: string, clientId: string, clientSecret: string, redirectUri?: string): Promise<AppleAuthorizationTokenResponseType> {
    const url = new URL(AppleAuth.ENDPOINT_URL)
    url.pathname = '/auth/token'

    const params = new URLSearchParams()
    params.append('client_id', clientId)
    params.append('client_secret', clientSecret)
    params.append('code', code)
    params.append('grant_type', 'authorization_code')
    if (redirectUri) params.append('redirect_uri', redirectUri)

    const resp = (await fetch(url.toString(), {
      method: 'POST',
      body: params,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })) as Response

    if (!resp.ok) throw RequestAppleAuthFail()

    return await resp.json<AppleAuthorizationTokenResponseType>()
  }

  private async verifyIdToken(idToken: string, clientId: string): Promise<AppleIdTokenType> {
    const { payload } = await jwtVerify(idToken, appleKeys, {
      issuer: AppleAuth.ENDPOINT_URL,
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat']
    })
    if (!payload.sub || payload.aud !== clientId) throw RequestAppleAuthFail()
    return payload as unknown as AppleIdTokenType
  }

  async loginWithApple(code: string, idToken: string, clientId: string, redirectUri?: string): Promise<AppleIdTokenType> {
    const appleClientId = clientId || this.clientId
    if (!this.clientIds.includes(appleClientId)) throw RequestAppleAuthFail()
    try {
      const clientSecret = await this.getClientSecret(appleClientId)
      const tokenResp = await this.getAuthorizationToken(code, appleClientId, clientSecret, redirectUri)
      const authResp = await this.verifyIdToken(tokenResp.id_token, appleClientId)
      if (idToken) {
        const userInfo = await this.verifyIdToken(idToken, appleClientId)
        if (userInfo.sub !== authResp.sub) throw RequestAppleAuthFail()
      }
      return authResp
    } catch {
      throw RequestAppleAuthFail()
    }
  }
}
