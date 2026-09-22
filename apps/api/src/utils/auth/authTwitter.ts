const TW_AUTH_URL = 'https://twitter.com/i/oauth2/authorize'
const TW_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token'
const TW_USER_URL = 'https://api.twitter.com/2/users/me'
const TW_REVOKE_URL = 'https://api.twitter.com/2/oauth2/revoke'

export interface TwitterOAuth2Options {
  clientId: string
  clientSecret: string
  callbackUrl: string
  scopes?: string[]
}

export interface AuthUrlResult {
  url: string
  state: string
  codeVerifier: string
}

export interface TokenResponse {
  accessToken: string
  refreshToken?: string
  expiresIn: number
  scope: string
  tokenType: string
}

export interface TwitterUser {
  id: string
  name: string
  username: string
  profileImageUrl?: string
  description?: string
  createdAt?: string
  publicMetrics?: {
    followersCount: number
    followingCount: number
    tweetCount: number
    listedCount: number
  }
}

export interface CallbackParams {
  code?: string
  state?: string
  error?: string
  error_description?: string
}

export class TwitterOAuth2 {
  private clientId: string
  private clientSecret: string
  private callbackUrl: string
  private scopes = ['tweet.read', 'users.read', 'offline.access']

  constructor(env: Env) {
    this.clientId = env.X_CLIENT_ID
    this.callbackUrl = env.BACKEND_API_PREFIX + '/callback/twitter'
    this.clientSecret = env.X_CLIENT_SECRET
  }

  async generateAuthUrl(): Promise<AuthUrlResult> {
    const state = generateRandomString(32)
    const codeVerifier = generateRandomString(64)
    const codeChallenge = await generateCodeChallenge(codeVerifier)

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      scope: this.scopes.join(' '),
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    })

    return {
      url: `${TW_AUTH_URL}?${params.toString()}`,
      state,
      codeVerifier
    }
  }

  async handleCallback(params: CallbackParams, codeVerifier: string, expectedState?: string): Promise<TokenResponse> {
    if (params.error) throw new Error(`Twitter OAuth error: ${params.error} - ${params.error_description}`)

    if (!params.code) throw new Error('Missing `code` parameter in callback')

    if (expectedState && params.state !== expectedState) throw new Error('Invalid `state` parameter - possible CSRF attack')

    const basicAuth = btoa(`${this.clientId}:${this.clientSecret}`)

    const response = await fetch(TW_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        code: params.code,
        grant_type: 'authorization_code',
        redirect_uri: this.callbackUrl,
        code_verifier: codeVerifier
      })
    })

    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Failed to exchange code for token: ${response.status}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
      scope: string
      token_type: string
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
      tokenType: data.token_type
    }
  }

  async getUser(accessToken: string): Promise<TwitterUser> {
    const params = new URLSearchParams({
      'user.fields': 'id,name,username,profile_image_url,description,created_at,public_metrics'
    })

    console.log(`${TW_USER_URL}?${params.toString()}`)
    const response = await fetch(`${TW_USER_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Failed to get user info: ${response.status}`)
    }

    const result = (await response.json()) as {
      data: {
        id: string
        name: string
        username: string
        profile_image_url?: string
        description?: string
        created_at?: string
        public_metrics?: {
          followers_count: number
          following_count: number
          tweet_count: number
          listed_count: number
        }
      }
    }

    const user = result.data

    return {
      id: user.id,
      name: user.name,
      username: user.username,
      profileImageUrl: user.profile_image_url,
      description: user.description,
      createdAt: user.created_at,
      publicMetrics: user.public_metrics
        ? {
            followersCount: user.public_metrics.followers_count,
            followingCount: user.public_metrics.following_count,
            tweetCount: user.public_metrics.tweet_count,
            listedCount: user.public_metrics.listed_count
          }
        : undefined
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const basicAuth = btoa(`${this.clientId}:${this.clientSecret}`)

    const response = await fetch(TW_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to refresh token: ${response.status} - ${errorText}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
      scope: string
      token_type: string
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
      tokenType: data.token_type
    }
  }

  async revokeToken(token: string): Promise<boolean> {
    const basicAuth = btoa(`${this.clientId}:${this.clientSecret}`)

    const response = await fetch(TW_REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        token: token,
        token_type_hint: 'access_token'
      })
    })

    return response.ok
  }
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, byte => chars[byte % chars.length]).join('')
}

async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64URLEncode(new Uint8Array(hash))
}

function base64URLEncode(buffer: Uint8Array): string {
  const str = String.fromCharCode(...buffer)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
