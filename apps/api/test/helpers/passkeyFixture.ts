import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@slax-reader/contracts/passkey'

const encode = (value: Uint8Array) => Buffer.from(value).toString('base64url')
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest()

export function passkeyAuthenticator(rpId = 'r.slax.dev', userUuid = 'opaque-account-uuid') {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = keys.publicKey.export({ format: 'jwk' })
  const credentialId = randomBytes(32)
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')]
    ])
  )
  return {
    id: encode(credentialId),
    public_key: cose,
    registration(challenge: string, origin = `https://${rpId}`, verified = true): RegistrationResponseJSON {
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }))
      const length = Buffer.alloc(2)
      length.writeUInt16BE(credentialId.length)
      const authData = Buffer.concat([digest(rpId), Buffer.from([verified ? 0x45 : 0x41]), Buffer.alloc(4), Buffer.alloc(16), length, credentialId, cose])
      const attestation = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, string>>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData]
        ])
      )
      return {
        id: encode(credentialId),
        rawId: encode(credentialId),
        type: 'public-key',
        response: { clientDataJSON: encode(clientData), attestationObject: encode(attestation), transports: ['internal'] },
        clientExtensionResults: {}
      }
    },
    assertion(challenge: string, origin = `https://${rpId}`, counter = 0, verified = true): AuthenticationResponseJSON {
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }))
      const count = Buffer.alloc(4)
      count.writeUInt32BE(counter)
      const authData = Buffer.concat([digest(rpId), Buffer.from([verified ? 0x05 : 0x01]), count])
      const signature = sign('sha256', Buffer.concat([authData, digest(clientData)]), keys.privateKey)
      return {
        id: encode(credentialId),
        rawId: encode(credentialId),
        type: 'public-key',
        response: { clientDataJSON: encode(clientData), authenticatorData: encode(authData), signature: encode(signature), userHandle: encode(Buffer.from(userUuid)) },
        clientExtensionResults: {}
      }
    }
  }
}
