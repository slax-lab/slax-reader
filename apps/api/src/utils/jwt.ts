import { jwtVerify, SignJWT, JWTHeaderParameters, JWTPayload } from 'jose'

export interface AuthPayload extends JWTPayload {
  id: string
  lang: string
  email: string
}

class Auth {
  private info: {
    expires: number
    secret: Uint8Array
    issuer: string
    parameter: JWTHeaderParameters
  }

  constructor(env: Env) {
    if (
      !env.JWT_SECRET_TEXT ||
      !env.JWT_ISSUER ||
      !['HS256', 'HS384', 'HS512'].includes(env.JWT_ALGORITHMS) ||
      !Number.isFinite(Number(env.JWT_EXPIRES)) ||
      Number(env.JWT_EXPIRES) <= 0
    ) {
      throw new Error('Invalid JWT configuration')
    }
    this.info = {
      secret: new TextEncoder().encode(env.JWT_SECRET_TEXT),
      issuer: env.JWT_ISSUER,
      expires: Number(env.JWT_EXPIRES),
      parameter: { alg: env.JWT_ALGORITHMS }
    }
  }

  sign(payload: AuthPayload): Promise<string> {
    const current = Math.round(new Date().getTime() / 1000)
    return new SignJWT(payload)
      .setExpirationTime(current + this.info.expires)
      .setIssuedAt(current)
      .setIssuer(this.info.issuer)
      .setAudience('reader')
      .setProtectedHeader(this.info.parameter)
      .sign(this.info.secret)
  }

  async verify(token: string): Promise<AuthPayload> {
    const verifyRes = await jwtVerify(token, this.info.secret, {
      issuer: this.info.issuer,
      audience: 'reader',
      algorithms: [this.info.parameter.alg],
      requiredClaims: ['exp', 'iat', 'iss', 'aud']
    })
    return verifyRes.payload as AuthPayload
  }
}

export { Auth }
