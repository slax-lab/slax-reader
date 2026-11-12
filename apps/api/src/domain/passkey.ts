import { generateAuthenticationOptions, generateRegistrationOptions } from '@simplewebauthn/server'
import type {
  PasskeyAuthenticationChallenge,
  PasskeyChallengeRequest,
  PasskeyInfo,
  PasskeyLoginRequest,
  PasskeyRegistrationChallenge,
  PasskeyRegistrationInput
} from '@slax-reader/contracts/passkey'
import { PasskeyVerificationError, UnauthorizedError } from '@/const/err'
import { PASSKEY_CONFIG } from '@/const/passkey'
import { inject, injectable } from '@/decorators/di'
import { PasskeyRepo, type PasskeyAccount, type PasskeyLoginMetadata, type PasskeyTransaction } from '@/infra/repository/dbPasskey'
import { PasskeyChallengeRepo } from '@/infra/repository/redisPasskeyChallenge'
import { passkeyConfiguration, verifyPasskeyAuthentication, verifyPasskeyRegistration } from '@/utils/passkey'

function activeAccount(account: PasskeyAccount | null): PasskeyAccount {
  if (!account || account.deleted_at) throw PasskeyVerificationError()
  return account
}

async function verifiedMailbox(tx: PasskeyTransaction) {
  const mailbox = await tx.findMailbox()
  if (!mailbox) throw PasskeyVerificationError()
  return mailbox
}

@injectable()
export class PasskeyService {
  constructor(
    @inject(PasskeyRepo) private credentials: PasskeyRepo,
    @inject(PasskeyChallengeRepo) private challenges: PasskeyChallengeRepo
  ) {}

  async challenge(env: Env, input: { purpose: 'register' }, userId: number): Promise<PasskeyRegistrationChallenge>
  async challenge(env: Env, input: { purpose: 'login'; email: string }): Promise<PasskeyAuthenticationChallenge>
  async challenge(env: Env, input: PasskeyChallengeRequest, userId?: number): Promise<PasskeyRegistrationChallenge | PasskeyAuthenticationChallenge> {
    const { rpId } = passkeyConfiguration(env)
    if (input.purpose === 'login') {
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        allowCredentials: [],
        userVerification: 'required',
        timeout: PASSKEY_CONFIG.CHALLENGE_SECONDS * 1000
      })
      const requestId = crypto.randomUUID()
      await this.challenges.save(
        env.RUN_TYPE,
        requestId,
        { purpose: 'login', emailKey: input.email.trim().toLowerCase(), rpId, challenge: options.challenge },
        PASSKEY_CONFIG.CHALLENGE_SECONDS
      )
      return { purpose: 'login', request_id: requestId, options }
    }
    if (!userId) throw UnauthorizedError()
    return this.credentials.withAccount(userId, async tx => {
      const account = activeAccount(tx.account)
      const mailbox = await verifiedMailbox(tx)
      const credentials = await tx.listCredentials(rpId)
      const requestId = crypto.randomUUID()
      const descriptors = credentials.map(item => ({ id: item.credential_id, transports: item.transports }))
      const options = await generateRegistrationOptions({
        rpID: rpId,
        rpName: PASSKEY_CONFIG.RP_NAME,
        userID: new TextEncoder().encode(account.uuid),
        userName: mailbox.user_name,
        userDisplayName: mailbox.user_name,
        timeout: PASSKEY_CONFIG.CHALLENGE_SECONDS * 1000,
        attestationType: 'none',
        excludeCredentials: descriptors,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
      })
      await this.challenges.save(
        env.RUN_TYPE,
        requestId,
        { purpose: 'register', userId: account.id, emailKey: mailbox.platform_id, rpId, challenge: options.challenge },
        PASSKEY_CONFIG.CHALLENGE_SECONDS
      )
      return { purpose: 'register', request_id: requestId, options }
    })
  }

  async linkCredential(env: Env, userId: number, input: PasskeyRegistrationInput): Promise<{ linked: true }> {
    const challenge = await this.challenges.consume(env.RUN_TYPE, input.request_id)
    const { rpId, origins } = passkeyConfiguration(env)
    if (!challenge || challenge.purpose !== 'register' || challenge.userId !== userId || challenge.rpId !== rpId) throw PasskeyVerificationError()
    const credential = await verifyPasskeyRegistration(input.credential, challenge.challenge, rpId, origins)
    return this.credentials.withAccount(userId, async tx => {
      const account = activeAccount(tx.account)
      const mailbox = await verifiedMailbox(tx)
      if (mailbox.platform_id !== challenge.emailKey) throw PasskeyVerificationError()
      if (!(await tx.createCredential({ ...credential, user_id: userId, rp_id: rpId, name: input.name }))) throw PasskeyVerificationError()
      await tx.saveSummary(account.uuid)
      return { linked: true }
    })
  }

  async authenticate(env: Env, input: PasskeyLoginRequest, profile: PasskeyLoginMetadata = { last_login_at: new Date() }): Promise<PasskeyAccount> {
    const challenge = await this.challenges.consume(env.RUN_TYPE, input.request_id)
    const { rpId, origins } = passkeyConfiguration(env)
    if (!challenge || challenge.purpose !== 'login' || challenge.rpId !== rpId || challenge.emailKey !== input.email.trim().toLowerCase()) throw PasskeyVerificationError()
    const owners = await this.credentials.findLoginAccounts(challenge.emailKey)
    if (owners.length !== 1) throw PasskeyVerificationError()
    const owner = activeAccount(owners[0])
    return this.credentials.withAccount(owner.id, async tx => {
      const account = activeAccount(tx.account)
      const mailbox = await verifiedMailbox(tx)
      if (mailbox.platform_id !== challenge.emailKey) throw PasskeyVerificationError()
      const credential = await tx.findCredential(input.credential.id, rpId)
      if (!credential) throw PasskeyVerificationError()
      const counter = await verifyPasskeyAuthentication(input.credential, challenge.challenge, rpId, origins, credential, account.uuid)
      await tx.updateCredential(credential.id, counter)
      await tx.recordLogin(profile)
      return account
    })
  }

  list(env: Env, userId: number): Promise<PasskeyInfo[]> {
    const { rpId } = passkeyConfiguration(env)
    return this.credentials.withAccount(userId, async tx => {
      activeAccount(tx.account)
      return (await tx.listCredentials(rpId)).map(item => ({
        uuid: item.uuid,
        name: item.name,
        created_at: item.created_at.toISOString(),
        last_used_at: item.last_used_at?.toISOString() ?? null
      }))
    })
  }

  remove(env: Env, userId: number, uuid: string): Promise<{ deleted: true }> {
    const { rpId } = passkeyConfiguration(env)
    return this.credentials.withAccount(userId, async tx => {
      activeAccount(tx.account)
      if (!(await tx.deleteCredential(uuid, rpId))) throw PasskeyVerificationError()
      if (!(await tx.countCredentials())) await tx.deleteSummary()
      return { deleted: true }
    })
  }
}
