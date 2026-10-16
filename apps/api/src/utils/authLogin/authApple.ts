import { RequestAppleAuthFail } from '../../const/err'
import { createRemoteJWKSet, errors, importPKCS8, jwtVerify, SignJWT } from 'jose'

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
const appleErrorCodes = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable'
])

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
  private readonly platform: string
  private readonly missingConfig: string[]

  static algorithm = 'ES256'
  static clientSecretKey = 'apple_client_secret'
  static applePublicKey = 'apple_public_key'
  static ENDPOINT_URL = 'https://appleid.apple.com'

  constructor(env: Env & { APPLE_WEB_CLIENT_ID?: string; APPLE_NATIVE_CLIENT_IDS?: string }, platform = 'web') {
    const webClientId = env.APPLE_WEB_CLIENT_ID?.trim() || ''
    this.platform = ['web', 'ios', 'macOS', 'android', 'windows'].includes(platform) ? platform : 'unsupported'
    this.missingConfig = Object.entries({
      APPLE_WEB_CLIENT_ID: webClientId,
      ...(['ios', 'macOS', 'android'].includes(platform) ? { APPLE_NATIVE_CLIENT_IDS: env.APPLE_NATIVE_CLIENT_IDS } : {}),
      APPLE_SIGN_KEY_ID: env.APPLE_SIGN_KEY_ID,
      APPLE_SIGN_TEAM_ID: env.APPLE_SIGN_TEAM_ID,
      APPLE_SIGN_AUTH_KEY: env.APPLE_SIGN_AUTH_KEY
    })
      .filter(([, value]) => typeof value !== 'string' || !value.trim())
      .map(([name]) => name)
    if (platform === 'web') {
      this.clientIds = webClientId ? [webClientId] : []
    } else if (['ios', 'macOS', 'android'].includes(platform)) {
      this.clientIds = (env.APPLE_NATIVE_CLIENT_IDS || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
      if (!this.clientIds.length && !this.missingConfig.includes('APPLE_NATIVE_CLIENT_IDS')) this.missingConfig.push('APPLE_NATIVE_CLIENT_IDS')
      if (!webClientId || this.clientIds.includes(webClientId)) {
        this.logFailure('configuration', !webClientId ? 'missing_web_client_id' : 'web_native_client_id_overlap')
        throw RequestAppleAuthFail()
      }
    } else {
      this.logFailure('configuration', 'unsupported_platform')
      throw RequestAppleAuthFail()
    }
    this.clientId = this.clientIds[0] || ''
    if (!this.clientId) {
      this.logFailure('configuration', 'missing_client_id')
      throw RequestAppleAuthFail()
    }
    this.keyId = env.APPLE_SIGN_KEY_ID
    this.privateKey = env.APPLE_SIGN_AUTH_KEY
    this.teamId = env.APPLE_SIGN_TEAM_ID
    try {
      this.privateKey = this.privateKey
        .replace(/\\n/g, '')
        .replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n')
        .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----')
        .replace(/(.{64})/g, '$1\n')
    } catch (error) {
      this.logFailure('configuration', 'private_key_normalization_failed', error)
      throw error
    }
  }

  private logFailure(stage: string, reason: string, error?: unknown, details?: { status?: number; appleError?: string; clientId?: string; hasRedirectUri?: boolean }) {
    // Only controlled metadata is logged; provider bodies and exception messages can contain credentials or PII.
    console.error(
      `[login] apple failed ${JSON.stringify({
        stage,
        reason,
        platform: this.platform,
        defaultClientId: this.clientId || undefined,
        missingConfig: this.missingConfig,
        configuredClientCount: this.clientIds?.length ?? 0,
        ...details,
        errorCode: error instanceof errors.JOSEError ? error.code : error instanceof TypeError ? 'TypeError' : error instanceof SyntaxError ? 'SyntaxError' : undefined,
        claim: error instanceof errors.JWTClaimValidationFailed && ['aud', 'iss', 'exp', 'iat', 'sub', 'nbf'].includes(error.claim) ? error.claim : undefined
      })}`
    )
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

    if (!resp.ok) {
      const body = await resp.json<{ error?: unknown }>().catch(() => null)
      this.logFailure('token_exchange', 'apple_rejected_request', undefined, {
        status: resp.status,
        clientId,
        hasRedirectUri: Boolean(redirectUri),
        appleError: typeof body?.error === 'string' && appleErrorCodes.has(body.error) ? body.error : 'unrecognized'
      })
      throw RequestAppleAuthFail()
    }

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
    if (!this.clientIds.includes(appleClientId)) {
      this.logFailure('configuration', 'unconfigured_client_id')
      throw RequestAppleAuthFail()
    }
    let stage = 'client_secret'
    try {
      const clientSecret = await this.getClientSecret(appleClientId)
      stage = 'token_exchange'
      const tokenResp = await this.getAuthorizationToken(code, appleClientId, clientSecret, redirectUri)
      stage = 'exchanged_id_token'
      const authResp = await this.verifyIdToken(tokenResp.id_token, appleClientId)
      if (idToken) {
        stage = 'client_id_token'
        const userInfo = await this.verifyIdToken(idToken, appleClientId)
        stage = 'subject_match'
        if (userInfo.sub !== authResp.sub) throw RequestAppleAuthFail()
      }
      return authResp
    } catch (error) {
      this.logFailure(stage, 'authentication_failed', error, { clientId: appleClientId, hasRedirectUri: Boolean(redirectUri) })
      throw RequestAppleAuthFail()
    }
  }
}
