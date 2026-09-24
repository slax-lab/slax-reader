import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const directory = fileURLToPath(new URL('../../../../deploy/local/powersync-local/', import.meta.url))
const names = ['dev-jwks-private.json', 'dev-jwks-public.json', 'compose.env']
if (names.some(name => existsSync(path.join(directory, name)))) {
  throw new Error('Key output already exists; refusing to replace local keys')
}
mkdirSync(directory, { recursive: true })
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const metadata = { kid: `local-${randomUUID()}`, alg: 'RS256', use: 'sig' }
const privateKey = {
  ...pair.privateKey.export({ format: 'jwk' }),
  ...metadata
}
const publicKey = { ...pair.publicKey.export({ format: 'jwk' }), ...metadata }
writeFileSync(path.join(directory, names[0]), JSON.stringify(privateKey) + '\n', { flag: 'wx', mode: 0o600 })
writeFileSync(path.join(directory, names[1]), JSON.stringify({ keys: [publicKey] }) + '\n', { flag: 'wx', mode: 0o644 })
writeFileSync(path.join(directory, names[2]), `PS_JWK_N=${publicKey.n}\nPS_JWK_E=${publicKey.e}\nPS_JWK_KID=${publicKey.kid}\n`, { flag: 'wx', mode: 0o600 })
console.log(
  'Created local PowerSync keys. Put the private JWK in deploy/local/.dev.vars as POWERSYNC_JWK_PRIVATE_KEY. setup derives the public verification key at runtime; existing configuration is never updated automatically.'
)
