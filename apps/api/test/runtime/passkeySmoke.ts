import assert from 'node:assert/strict'
import type { PasskeyAuthenticationChallenge, PasskeyDeleteResponse, PasskeyInfo, PasskeyRegistrationChallenge } from '@slax-reader/contracts/passkey'
import { passkeyAuthenticator } from '../helpers/passkeyFixture'

type AuthCall = <T = unknown>(path: string, body?: object, bearer?: string) => Promise<{ code: number; data: T }>

export async function exercisePasskeys(call: AuthCall, sql: (query: string) => string, token: string, otherToken: string, origin: string) {
  const uuid = sql('SELECT uuid FROM sr_user WHERE id=1')
  const rp = new URL(origin).hostname
  const first = passkeyAuthenticator(rp, uuid)
  const second = passkeyAuthenticator(rp, uuid)
  const email = 'saver@smoke.invalid'
  const challengePath = '/v1/user/passkey/challenge'
  const list = async (bearer = token) => {
    const result = await call<PasskeyInfo[]>('/v1/user/passkey', undefined, bearer)
    assert.equal(result.code, 200, JSON.stringify(result))
    return result.data
  }
  const register = async (authenticator: ReturnType<typeof passkeyAuthenticator>, name: string) => {
    const issued = await call<PasskeyRegistrationChallenge>(challengePath, { purpose: 'register' }, token)
    assert.equal(issued.code, 200, JSON.stringify(issued))
    assert.equal(issued.data.options.rp.id, rp)
    const proof = { type: 'passkey', request_id: issued.data.request_id, credential: authenticator.registration(issued.data.options.challenge, origin), name }
    const response = await call('/v1/user/setting', { key: 'bind_login_identity', value: proof }, token)
    assert.equal(response.code, 200, JSON.stringify(response))
    assert.deepEqual(response.data, { linked: true })
    assert.notEqual((await call('/v1/user/setting', { key: 'bind_login_identity', value: proof }, token)).code, 200)
  }
  assert.equal((await call(challengePath, { purpose: 'register' })).code, 401)
  assert.equal((await call('/v1/user/passkey')).code, 401)
  await register(first, 'First device')
  await register(second, 'Second device')
  const duplicate = await call<PasskeyRegistrationChallenge>(challengePath, { purpose: 'register' }, token)
  assert.equal(duplicate.code, 200, JSON.stringify(duplicate))
  const duplicateResult = await call(
    '/v1/user/setting',
    {
      key: 'bind_login_identity',
      value: { type: 'passkey', request_id: duplicate.data.request_id, credential: first.registration(duplicate.data.options.challenge, origin), name: 'Duplicate' }
    },
    token
  )
  assert.equal(duplicateResult.code, 400, JSON.stringify(duplicateResult))
  const stored = await list()
  assert.equal(stored.length, 2)
  assert.equal(sql("SELECT count(*) FROM sr_platform_bind WHERE user_id=1 AND platform='passkey'"), '1')
  assert.equal(JSON.stringify(stored).includes('public_key'), false)
  assert.notEqual((await call('/v1/user/setting', { key: 'delete_passkey', value: { id: stored[0].id } }, otherToken)).code, 200)
  assert.equal((await list()).length, 2)

  const issue = async () => {
    const result = await call<PasskeyAuthenticationChallenge>(challengePath, { purpose: 'login', email })
    assert.equal(result.code, 200, JSON.stringify(result))
    assert.deepEqual(result.data.options.allowCredentials, [])
    return result.data
  }
  const unknownMailbox = await call<PasskeyAuthenticationChallenge>(challengePath, { purpose: 'login', email: 'unknown@smoke.invalid' })
  assert.equal(unknownMailbox.code, 200, JSON.stringify(unknownMailbox))
  assert.deepEqual(unknownMailbox.data.options.allowCredentials, [])
  assert.equal(
    (
      await call('/v1/user/login', {
        type: 'passkey',
        email: 'unknown@smoke.invalid',
        request_id: unknownMailbox.data.request_id,
        credential: first.assertion(unknownMailbox.data.options.challenge, origin)
      })
    ).code,
    400
  )
  const absentCredential = passkeyAuthenticator(rp, uuid)
  for (const mailbox of [email, 'unknown@smoke.invalid']) {
    const issued = await call<PasskeyAuthenticationChallenge>(challengePath, { purpose: 'login', email: mailbox })
    assert.equal(issued.code, 200)
    const missing = await call('/v1/user/login', {
      type: 'passkey',
      email: mailbox,
      request_id: issued.data.request_id,
      credential: absentCredential.assertion(issued.data.options.challenge, origin)
    })
    assert.equal(missing.code, 400)
    assert.equal(missing.data, 'PASSKEY_CREDENTIAL_UNKNOWN')
  }
  const authentication = await issue()
  const proof = { type: 'passkey', email, request_id: authentication.request_id, credential: first.assertion(authentication.options.challenge, origin) }
  const result = await call<{ user_id: string; is_new_user: boolean; token: string }>('/v1/user/login', proof)
  assert.equal(result.code, 200, JSON.stringify(result))
  assert.equal(result.data.is_new_user, false)
  assert.ok(result.data.token)
  assert.notEqual((await call('/v1/user/login', proof)).code, 200)
  assert.equal(sql('SELECT counter FROM sr_user_passkey ORDER BY id LIMIT 1'), '0')

  const wrongOrigin = await issue()
  assert.notEqual(
    (
      await call('/v1/user/login', {
        type: 'passkey',
        email,
        request_id: wrongOrigin.request_id,
        credential: first.assertion(wrongOrigin.options.challenge, 'https://attacker.invalid')
      })
    ).code,
    200
  )
  const wrongMailbox = await call<PasskeyAuthenticationChallenge>(challengePath, { purpose: 'login', email: 'rollout-owner@smoke.invalid' })
  assert.equal(wrongMailbox.code, 200)
  const wrongMailboxResult = await call('/v1/user/login', {
    type: 'passkey',
    email: 'rollout-owner@smoke.invalid',
    request_id: wrongMailbox.data.request_id,
    credential: first.assertion(wrongMailbox.data.options.challenge, origin)
  })
  assert.equal(wrongMailboxResult.code, 400)
  assert.equal(wrongMailboxResult.data, 'PASSKEY_VERIFICATION_FAILED')

  const firstDeletion = await call<PasskeyDeleteResponse>('/v1/user/setting', { key: 'delete_passkey', value: { id: stored[0].id } }, token)
  assert.equal(firstDeletion.code, 200, JSON.stringify(firstDeletion))
  assert.deepEqual(firstDeletion.data, { deleted: true, credential_state: { rp_id: rp, user_handle: Buffer.from(uuid).toString('base64url'), credential_ids: [second.id] } })
  assert.equal(sql("SELECT count(*) FROM sr_platform_bind WHERE user_id=1 AND platform='passkey'"), '1')
  const beforeDeletion = await issue()
  const lastDeletion = await call<PasskeyDeleteResponse>('/v1/user/setting', { key: 'delete_passkey', value: { id: stored[1].id } }, token)
  assert.equal(lastDeletion.code, 200, JSON.stringify(lastDeletion))
  assert.deepEqual(lastDeletion.data, { deleted: true, credential_state: { rp_id: rp, user_handle: Buffer.from(uuid).toString('base64url'), credential_ids: [] } })
  assert.equal((await list()).length, 0)
  assert.equal(sql("SELECT count(*) FROM sr_platform_bind WHERE user_id=1 AND platform='passkey'"), '0')
  const deletedCredential = await call('/v1/user/login', {
    type: 'passkey',
    email,
    request_id: beforeDeletion.request_id,
    credential: second.assertion(beforeDeletion.options.challenge, origin)
  })
  assert.equal(deletedCredential.code, 400)
  assert.equal(deletedCredential.data, 'PASSKEY_CREDENTIAL_UNKNOWN')
  assert.equal(sql("SELECT count(*) FROM sr_platform_bind WHERE user_id=1 AND platform='mail'"), '1')
  await register(first, 'Cleanup device')
  return 'real ES256 registration/assertion in Workers; existing session, zero counters, one-use challenge, origin/mailbox ownership, multiple keys, owner-only deletion and summary consistency'
}
